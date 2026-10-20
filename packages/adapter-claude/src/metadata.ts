import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  query,
  type Options,
  type SDKControlInitializeResponse,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentCommand, AgentModel, AgentUserConfig, SandboxCheck } from '@skaro/timeline';
import type { ClaudeRuntime } from './runtime.ts';

/** Loaded only for SDK metadata operations; account checks do not need a native session. */
export class ClaudeMetadata {
  private readonly runtime: ClaudeRuntime;

  constructor(runtime: ClaudeRuntime) {
    this.runtime = runtime;
  }

  async listModels(cwd: string): Promise<AgentModel[]> {
    const init = await this.initialize(cwd);
    // Aliases ("default", "opus") become the model they stand for: the name is the model's own
    // ("Opus 5.5", from "Opus 5.5 · Best for…"), and two aliases of one model are one row.
    const models: AgentModel[] = [];
    init.models.forEach((m, index) => {
      const id = m.value.startsWith('claude-') ? m.value : (m.resolvedModel ?? m.value);
      const isDefault = m.value === 'default' || index === 0;
      const known = models.find((x) => x.id === id);
      if (known) {
        known.isDefault ||= isDefault;
        return;
      }
      const [head, ...rest] = m.description.split(' · ');
      const named = head !== undefined && rest.length > 0 && /\d/.test(head);
      models.push({
        id,
        name: named ? head : m.displayName,
        description: named ? rest.join(' · ') : m.description,
        isDefault,
        efforts: (m.supportedEffortLevels ?? []).map((e) => ({ id: e })),
        images: true,
      });
    });
    return models;
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    const init = await this.initialize(cwd);
    return init.commands.map((c) => ({
      name: c.name,
      description: c.description,
      kind: c.builtin ? 'command' : 'skill',
    }));
  }

  /** MCP servers connect at start; the status is read once none is still connecting. */
  async userConfig(cwd: string): Promise<AgentUserConfig> {
    const dir = this.runtime.configDir();
    const q = query({
      prompt: never(),
      options: {
        cwd,
        pathToClaudeCodeExecutable: await this.runtime.requireExecutable(),
        env: this.runtime.env(),
      },
    });
    try {
      const init = await q.initializationResult();
      let servers = await q.mcpServerStatus();
      for (let i = 0; i < 40 && servers.some((s) => s.status === 'pending'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        servers = await q.mcpServerStatus();
      }
      return {
        dir,
        mcp: servers.map((s) => ({
          name: s.name,
          state:
            s.status === 'connected'
              ? 'ok'
              : s.status === 'needs-auth'
                ? 'needs_auth'
                : s.status === 'disabled'
                  ? 'disabled'
                  : 'failed',
          tools: s.tools?.length ?? 0,
          ...(s.error ? { error: s.error } : {}),
        })),
        skills: init.commands.filter((c) => !c.builtin).length,
        hooks: await countHooks(join(dir, 'settings.json')),
      };
    } finally {
      q.close();
    }
  }

  /**
   * D-28: the CLI refuses to start with `sandbox.failIfUnavailable` when the platform has no
   * working sandbox, before any model call. Where it starts, the Bash sandbox is in place.
   */
  async checkSandbox(scratchDir: string): Promise<SandboxCheck> {
    try {
      await this.initialize(scratchDir, { sandbox: { enabled: true, failIfUnavailable: true } });
      return { holds: true, detail: 'Bash sandbox available' };
    } catch (error) {
      return { holds: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Starts the CLI without a prompt: models, commands and account come with initialize. */
  private async initialize(
    cwd: string,
    extra: Partial<Options> = {},
  ): Promise<SDKControlInitializeResponse> {
    const q = query({
      prompt: never(),
      options: {
        cwd,
        pathToClaudeCodeExecutable: await this.runtime.requireExecutable(),
        env: this.runtime.env(),
        ...extra,
      },
    });
    try {
      return await q.initializationResult();
    } finally {
      q.close();
    }
  }
}

/** Hook commands in a settings file: `hooks: { Event: [{ matcher, hooks: [...] }] }`. */
async function countHooks(path: string): Promise<number> {
  try {
    const settings = JSON.parse(await readFile(path, 'utf8')) as { hooks?: unknown };
    const events = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    let count = 0;
    for (const groups of Object.values(events)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const hooks = (group as { hooks?: unknown }).hooks;
        count += Array.isArray(hooks) ? hooks.length : 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** Input that never yields: the CLI initializes and waits. */
function never(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<never>>(() => undefined),
    }),
  };
}
