// OpenCode as a Skaro agent. Models, commands and user settings come from a short-lived local
// server; sessions get their own private server (see session.ts).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  arr,
  obj,
  str,
  type AgentAdapter,
  type AgentCommand,
  type AgentLimits,
  type AgentMcpServer,
  type AgentModel,
  type AgentSession,
  type AgentStatus,
  type AgentUserConfig,
  type SandboxCheck,
  type SessionOptions,
} from '@skaro/timeline';
import { openCodeConfigDir, openCodeVersion, resolveOpenCodeBinary } from './bin.ts';
import { OpenCodeClient, startServer } from './server.ts';
import { OpenCodeSession } from './session.ts';

const ADAPTER_VERSION = '0.1.0';

interface Catalogue {
  models: AgentModel[];
  commands: AgentCommand[];
}

let catalogue: { at: number; value: Catalogue } | undefined;

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode' as const;
  readonly adapterVersion = ADAPTER_VERSION;
  private readonly binaryOverride: string | undefined;

  constructor(options: { binary?: string } = {}) {
    this.binaryOverride = options.binary;
  }

  private async binary(): Promise<string | undefined> {
    return this.binaryOverride ?? resolveOpenCodeBinary();
  }

  async status(): Promise<AgentStatus> {
    const binary = await this.binary();
    if (!binary) return { installed: false };
    const raw = openCodeVersion();
    const version = raw ? (/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(raw)?.[0] ?? raw) : undefined;
    // The free OpenCode models work without a separate sign-in, so the agent is usable once the
    // binary is present; auth failures surface on the first prompt.
    return { installed: true, ...(version ? { version } : {}) };
  }

  async login(): Promise<void> {
    const binary = await this.binary();
    if (!binary) throw new Error('OpenCode is not installed');
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['auth', 'login'], { stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`opencode auth login exited (${code})`)),
      );
    });
  }

  async listModels(cwd: string): Promise<AgentModel[]> {
    return (await this.catalogue(cwd)).models;
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    return (await this.catalogue(cwd)).commands;
  }

  async userConfig(_cwd: string): Promise<AgentUserConfig> {
    const dir = openCodeConfigDir();
    const config = readConfig(dir);
    const servers = obj(obj(config?.['mcp'])?.['servers']) ?? {};
    const mcp: AgentMcpServer[] = Object.entries(servers).map(([name, raw]) => {
      const server = obj(raw) ?? {};
      const disabled = server['enabled'] === false || server['disabled'] === true;
      return { name, state: disabled ? 'disabled' : 'ok', tools: 0 };
    });
    return {
      dir,
      mcp,
      skills: countSkills(dir),
      hooks: 0,
    };
  }

  async limits(_cwd: string): Promise<AgentLimits> {
    return { checkedAt: new Date().toISOString(), windows: [] };
  }

  async checkSandbox(_scratchDir: string): Promise<SandboxCheck> {
    return {
      holds: false,
      detail:
        'OpenCode has no OS sandbox on this machine. File and command approvals are asked in Skaro.',
    };
  }

  async start(options: SessionOptions): Promise<AgentSession> {
    return new OpenCodeSession(options, this.binaryOverride);
  }

  private async catalogue(cwd: string): Promise<Catalogue> {
    if (catalogue && Date.now() - catalogue.at < 120_000) return catalogue.value;
    const binary = await this.binary();
    if (!binary) throw new Error('OpenCode is not installed');
    const server = await startServer({ binary, cwd });
    try {
      const client = new OpenCodeClient(server);
      const [models, commands, skills, config] = await Promise.all([
        client
          .request<Record<string, unknown>>('GET', '/api/model')
          .catch(() => ({}) as Record<string, unknown>),
        client
          .request<Record<string, unknown>>('GET', '/api/command')
          .catch(() => ({}) as Record<string, unknown>),
        client
          .request<Record<string, unknown>>('GET', '/api/skill')
          .catch(() => ({}) as Record<string, unknown>),
        client
          .request<Record<string, unknown>>('GET', '/api/config')
          .catch(() => ({}) as Record<string, unknown>),
      ]);
      const configuredDefault = str(obj(config['data'])?.['model']) ?? readConfigDefaultModel();
      const value: Catalogue = {
        models: projectModels(
          arr(models['data']).length ? arr(models['data']) : arr(models),
          configuredDefault,
        ),
        commands: [
          ...arr(commands['data']).map((raw) => commandOf(raw, 'command')),
          ...arr(skills['data']).map((raw) => commandOf(raw, 'skill')),
        ].filter((command): command is AgentCommand => command !== undefined),
      };
      catalogue = { at: Date.now(), value };
      return value;
    } finally {
      server.close();
    }
  }
}

function projectModels(raw: unknown[], configuredDefault: string | undefined): AgentModel[] {
  const models: AgentModel[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const model = obj(value);
    if (!model || model['enabled'] === false) continue;
    const providerID = str(model['providerID']);
    const id = str(model['modelID']) ?? str(model['id']);
    if (!providerID || !id) continue;
    const ref = `${providerID}/${id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const capabilities = obj(model['capabilities']) ?? {};
    const variants = arr(model['variants'])
      .map((raw) => obj(raw))
      .filter((variant): variant is Record<string, unknown> => Boolean(variant))
      .map((variant) => ({
        id: str(variant['id']) ?? '',
        ...(str(obj(variant['settings'])?.['reasoningEffort'])
          ? { description: str(obj(variant['settings'])?.['reasoningEffort'])! }
          : {}),
      }))
      .filter((variant) => variant.id);
    models.push({
      id: ref,
      name: str(model['name']) ?? id,
      description: [providerID, str(model['family'])].filter(Boolean).join(' · '),
      isDefault: configuredDefault === ref,
      efforts: variants,
      ...(variants.some((variant) => variant.id === 'high') ? { defaultEffort: 'high' } : {}),
      images: arr(capabilities['input']).includes('image'),
    });
  }
  if (models.length && !models.some((model) => model.isDefault)) {
    const preferred =
      models.find((model) => model.id === 'opencode/deepseek-v4.1-flash-free') ?? models[0]!;
    preferred.isDefault = true;
  }
  return models;
}

function commandOf(raw: unknown, kind: 'command' | 'skill'): AgentCommand | undefined {
  const command = obj(raw);
  const name = str(command?.['name']);
  if (!name) return undefined;
  return { name, description: str(command?.['description']) ?? '', kind };
}

function readConfig(dir: string): Record<string, unknown> | undefined {
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      const text = readFileSync(path, 'utf8');
      try {
        return obj(JSON.parse(text));
      } catch {
        return obj(JSON.parse(stripComments(text)));
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readConfigDefaultModel(): string | undefined {
  return str(readConfig(openCodeConfigDir())?.['model']);
}

function countSkills(dir: string): number {
  for (const name of ['skill', 'skills']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .length;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Exported for the desktop's diagnostics. */
export const openCodeAdapterVersion = ADAPTER_VERSION;
