import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudeAdapterConfig {
  /** Path of the installed pinned binary, or undefined when not installed yet. */
  executable: () => Promise<string | undefined>;
  configDir?: string;
}

/** Shared binary and environment resolution for CLI, SDK metadata and sessions. */
export class ClaudeRuntime {
  readonly config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig) {
    this.config = config;
  }

  async requireExecutable(): Promise<string> {
    const executable = await this.config.executable();
    if (!executable) throw new Error('Claude Code is not installed');
    return executable;
  }

  configDir(): string {
    return this.config.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  }

  env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.config.configDir ? { CLAUDE_CONFIG_DIR: this.config.configDir } : {}),
    };
  }
}
