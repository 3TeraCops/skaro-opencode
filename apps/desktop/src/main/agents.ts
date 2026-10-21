// Agents in the main process (architecture.md 5): pinned binaries downloaded on first use,
// adapters, account status, models and "/" commands, and the sandbox self-check (D-28).

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter } from '@skaro/adapter-claude/adapter';
import { CodexAdapter, CodexAuthRevision } from '@skaro/adapter-codex';
import { nativeAdapter } from './native/adapter';
import { OpenCodeAdapter, openCodeConfigDir } from '@skaro/adapter-opencode';
import { AgentInstaller, agentPackage, type AgentId } from '@skaro/core';
import type {
  AgentAdapter,
  AgentCommand,
  AgentModel,
  AgentUserConfig,
  SandboxCheck,
} from '@skaro/timeline';
import { agentDefaultsKey, agentReady, type AgentInfo } from '../shared/ipc';

export const AGENT_IDS: readonly AgentId[] = ['claude-code', 'codex', 'opencode'];

/** Approximate download size shown before the first download (bytes). */
const DOWNLOAD_SIZE: Record<AgentId, number> = {
  'claude-code': 230e6,
  codex: 90e6,
  opencode: 0,
};

interface Store {
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
}

export class AgentManager {
  private readonly installer: AgentInstaller;
  private readonly adapters: Record<AgentId, AgentAdapter>;
  private readonly info = new Map<AgentId, AgentInfo>();
  private readonly downloads = new Map<AgentId, Promise<void>>();
  private readonly models = new Map<string, Promise<AgentModel[]>>();
  private readonly commands = new Map<string, Promise<AgentCommand[]>>();
  private readonly configs = new Map<string, Promise<AgentUserConfig>>();
  /** Status checks in progress. */
  private readonly checks = new Map<AgentId, Promise<AgentInfo>>();
  private readonly locale: () => string;
  private readonly scratchDir: string;
  private readonly store: Store;
  private readonly onChange: (agents: AgentInfo[]) => void;
  private readonly attachmentsDir?: string;
  private readonly authRevision = new SharedArrayBuffer(4);

  constructor(options: {
    agentsDir: string;
    scratchDir: string;
    store: Store;
    openUrl: (url: string) => void;
    onChange: (agents: AgentInfo[]) => void;
    /** Language of messages the user sees. */
    locale?: () => string;
    attachmentsDir?: string;
  }) {
    this.locale = options.locale ?? (() => 'en');
    this.installer = new AgentInstaller({ dir: options.agentsDir });
    this.scratchDir = options.scratchDir;
    this.store = options.store;
    this.onChange = options.onChange;
    this.attachmentsDir = options.attachmentsDir;
    this.adapters = {
      'claude-code': new ClaudeAdapter({
        executable: async () => (await this.installer.installed('claude-code'))?.binary,
      }),
      codex: new CodexAdapter({
        authRevision: new CodexAuthRevision(this.authRevision),
        binary: async () => {
          const installed = await this.installer.installed('codex');
          return installed && { binary: installed.binary, pathDirs: installed.pathDirs };
        },
        openUrl: options.openUrl,
      }),
      opencode: new OpenCodeAdapter(),
    };
    for (const id of AGENT_IDS) {
      this.info.set(id, { id, installed: false, sizeBytes: DOWNLOAD_SIZE[id], checking: true });
    }
  }

  adapter(id: AgentId): AgentAdapter {
    const adapter = this.adapters[id];
    // OpenCode is external: no downloaded binary to hand to the native attachment layer.
    if (!this.attachmentsDir || id === 'opencode') return adapter;
    return nativeAdapter(adapter, async () => {
      const installed = await this.installer.installed(id);
      if (!installed) throw new Error('The agent is not installed');
      return {
        agent: id,
        binary: installed.binary,
        pathDirs: installed.pathDirs ?? [],
        attachmentsDir: this.attachmentsDir!,
        authRevision: this.authRevision,
      };
    });
  }

  list(): AgentInfo[] {
    return AGENT_IDS.map((id) => this.info.get(id)!);
  }

  /** The preferred agent if it is ready, else the first ready one (an absent agent is inactive). */
  readyAgent(preferred: AgentId): AgentId {
    const list = this.list();
    // Installation/auth checks are still pending; requireReady waits instead of switching.
    if (list.find((a) => a.id === preferred)?.checking) return preferred;
    if (list.some((a) => a.id === preferred && agentReady(a))) return preferred;
    return list.find(agentReady)?.id ?? preferred;
  }

  /**
   * Throws unless the agent is downloaded and signed in: Skaro never works without one. Right
   * after start the agents are still being checked; this waits for the check.
   */
  async requireReady(id: AgentId): Promise<void> {
    let info = this.info.get(id);
    if (!info || info.checking) info = await (this.checks.get(id) ?? this.refreshOne(id));
    const name = id === 'codex' ? 'Codex' : id === 'opencode' ? 'OpenCode' : 'Claude Code';
    const ru = this.locale() === 'ru';
    if (!info?.installed) {
      throw new Error(
        ru
          ? `${name} не загружен — загрузите его в «Настройки → Агенты»`
          : `${name} is not downloaded — add it in Settings → Agents`,
      );
    }
    if (info.authenticated === false) {
      throw new Error(
        ru
          ? `${name}: не выполнен вход — войдите в «Настройки → Агенты»`
          : `${name} is not signed in — sign in in Settings → Agents`,
      );
    }
  }

  /** Default model and effort set in Settings → Agents. */
  defaults(id: AgentId): { model?: string; effort?: string } {
    const saved = this.store.getSetting(agentDefaultsKey(id)) as {
      model?: string;
      effort?: string;
    } | null;
    return saved ?? {};
  }

  /** Re-reads install and sign-in state of every agent. */
  async refresh(): Promise<AgentInfo[]> {
    // "Проверить снова" also re-reads the user's agent settings (MCP servers may be fixed now).
    this.configs.clear();
    await Promise.all(AGENT_IDS.map((id) => this.refreshOne(id)));
    return this.list();
  }

  refreshOne(id: AgentId): Promise<AgentInfo> {
    const running = this.checks.get(id);
    if (running) return running;
    const check = this.check(id).finally(() => this.checks.delete(id));
    this.checks.set(id, check);
    return check;
  }

  private async check(id: AgentId): Promise<AgentInfo> {
    const previous = this.info.get(id)!;
    let next: AgentInfo;
    try {
      const status = await this.adapters[id].status();
      next = {
        id,
        installed: status.installed,
        version: status.installed
          ? id === 'opencode'
            ? status.version
            : agentPackage(id).shownVersion
          : undefined,
        authenticated: status.authenticated,
        account: status.account,
        sizeBytes: DOWNLOAD_SIZE[id],
        ...(previous.download ? { download: previous.download } : {}),
      };
    } catch (error) {
      next = {
        id,
        installed: id === 'opencode' ? false : (await this.installer.installed(id)) !== undefined,
        sizeBytes: DOWNLOAD_SIZE[id],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.set(next);
    return next;
  }

  /** Downloads the pinned binary; progress goes out through `onChange`. */
  install(id: AgentId): Promise<void> {
    const running = this.downloads.get(id);
    if (running) return running;
    if (id === 'opencode') {
      const task = (async () => {
        const status = await this.adapters.opencode.status();
        if (!status.installed)
          throw new Error(
            'OpenCode is not installed. Install the OpenCode desktop app or put `opencode` on PATH.',
          );
        await this.refreshOne(id);
      })();
      this.downloads.set(id, task);
      void task.finally(() => this.downloads.delete(id));
      return task;
    }
    const task = (async () => {
      let lastReport = 0;
      this.patch(id, { download: { received: 0 } });
      try {
        await this.installer.install(id, (received, total) => {
          const now = Date.now();
          if (now - lastReport < 200 && received !== total) return;
          lastReport = now;
          this.patch(id, { download: { received, ...(total ? { total } : {}) } });
        });
        this.patch(id, { download: undefined, error: undefined });
      } catch (error) {
        this.patch(id, {
          download: undefined,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        this.downloads.delete(id);
      }
      await this.refreshOne(id);
    })();
    this.downloads.set(id, task);
    return task;
  }

  async login(id: AgentId): Promise<void> {
    await this.adapters[id].login();
    await this.refreshOne(id);
  }

  /** Models of an agent (cached per working folder). */
  listModels(id: AgentId, cwd: string): Promise<AgentModel[]> {
    return this.cached(this.models, `${id}\n${cwd}`, () => this.adapters[id].listModels(cwd));
  }

  /** The user's agent settings; before the agent is downloaded, only where they live. */
  userConfig(id: AgentId, cwd: string): Promise<AgentUserConfig> {
    if (!this.info.get(id)?.installed) {
      return Promise.resolve({ dir: this.configDir(id), mcp: [], skills: 0, hooks: 0 });
    }
    return this.cached(this.configs, `${id}\n${cwd}`, () => this.adapters[id].userConfig(cwd));
  }

  /** ~/.claude or ~/.codex, or where the environment points them. */
  configDir(id: AgentId): string {
    if (id === 'opencode') return openCodeConfigDir();
    return id === 'codex'
      ? (process.env['CODEX_HOME'] ?? join(homedir(), '.codex'))
      : (process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'));
  }

  listCommands(id: AgentId, cwd: string): Promise<AgentCommand[]> {
    return this.cached(this.commands, `${id}\n${cwd}`, () => this.adapters[id].listCommands(cwd));
  }

  /** D-28 self-check before the first run, remembered per agent version. */
  async sandbox(id: AgentId): Promise<SandboxCheck> {
    const key = `agents.${id}.sandbox`;
    const version =
      id === 'opencode' ? (this.info.get(id)?.version ?? 'external') : agentPackage(id).version;
    const saved = this.store.getSetting(key) as (SandboxCheck & { version: string }) | null;
    if (saved && saved.version === version) return saved;
    const dir = join(this.scratchDir, 'sandbox-check');
    await mkdir(dir, { recursive: true });
    const check = await this.adapters[id].checkSandbox(dir);
    this.store.setSetting(key, { ...check, version });
    return check;
  }

  private cached<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit) return hit;
    const promise = load();
    cache.set(key, promise);
    // Failures are not cached: "Повторить" asks again.
    promise.catch(() => cache.delete(key));
    return promise;
  }

  private patch(id: AgentId, patch: Partial<AgentInfo>): void {
    const next = { ...this.info.get(id)!, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as Record<string, unknown>)[k];
    }
    this.set(next);
  }

  private set(info: AgentInfo): void {
    this.info.set(info.id, info);
    this.onChange(this.list());
  }
}
