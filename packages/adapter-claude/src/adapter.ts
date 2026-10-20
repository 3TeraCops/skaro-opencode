// Adapter composition: CLI accounts are independent of SDK metadata and session execution.
import type {
  AgentAdapter,
  AgentCommand,
  AgentModel,
  AgentSession,
  AgentStatus,
  AgentUserConfig,
  SandboxCheck,
  SessionOptions,
} from '@skaro/timeline';
import { CLAUDE_ADAPTER_VERSION } from './projector.ts';
import { claudeStatus, loginClaude } from './account.ts';
import { ClaudeRuntime, type ClaudeAdapterConfig } from './runtime.ts';

export type { ClaudeAdapterConfig } from './runtime.ts';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude-code' as const;
  readonly adapterVersion = CLAUDE_ADAPTER_VERSION;
  private readonly runtime: ClaudeRuntime;

  constructor(config: ClaudeAdapterConfig) {
    this.runtime = new ClaudeRuntime(config);
  }

  status(): Promise<AgentStatus> {
    return claudeStatus(this.runtime);
  }

  login(): Promise<void> {
    return loginClaude(this.runtime);
  }

  async listModels(cwd: string): Promise<AgentModel[]> {
    return (await this.metadata()).listModels(cwd);
  }

  async listCommands(cwd: string): Promise<AgentCommand[]> {
    return (await this.metadata()).listCommands(cwd);
  }

  async userConfig(cwd: string): Promise<AgentUserConfig> {
    return (await this.metadata()).userConfig(cwd);
  }

  async checkSandbox(scratchDir: string): Promise<SandboxCheck> {
    return (await this.metadata()).checkSandbox(scratchDir);
  }

  async limits(cwd: string) {
    const { readClaudeLimits } = await import('./limits.ts');
    return readClaudeLimits(await this.runtime.requireExecutable(), cwd, this.runtime.env());
  }

  async start(options: SessionOptions): Promise<AgentSession> {
    const { ClaudeSession } = await import('./session.ts');
    const session = new ClaudeSession(options, {
      executable: await this.runtime.requireExecutable(),
      ...(this.runtime.config.configDir ? { configDir: this.runtime.config.configDir } : {}),
    });
    session.start();
    return session;
  }

  private async metadata() {
    const { ClaudeMetadata } = await import('./metadata.ts');
    return new ClaudeMetadata(this.runtime);
  }
}
