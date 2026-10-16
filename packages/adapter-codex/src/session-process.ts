import { obj, str, type AgentError, type SessionOptions } from '@skaro/timeline';
import { AppServer, type AppServerOptions, type CodexBinary } from './rpc.ts';
import { codexMcpConfig } from './mcp-config.ts';
import { errorCategory } from './projector-helpers.ts';
import { codexPolicy } from './session-policy.ts';
import { CodexSessionAuth, type CodexAuthRevision } from './session-auth.ts';

export interface CodexSessionConfig extends CodexBinary {
  /** `-c key=value` overrides, e.g. the Windows sandbox mode chosen by the self-check. */
  config?: string[];
  codexHome?: string;
  authRevision?: CodexAuthRevision;
}

interface Connection {
  server?: AppServer;
  retiring: boolean;
  ready: boolean;
}

type Callbacks = Pick<AppServerOptions, 'onRaw' | 'onMessage' | 'onExit'>;
interface Thread {
  threadId: string;
  model: string;
}

/** Owns native process replacement; the session, projector and event stream survive it. */
export class CodexSessionProcess {
  private readonly auth: CodexSessionAuth;
  private connection: Connection | undefined;
  private opening: Promise<Thread> | undefined;
  private closed = false;
  private readonly options: SessionOptions;
  private readonly config: CodexSessionConfig;
  private readonly callbacks: Callbacks;

  constructor(options: SessionOptions, config: CodexSessionConfig, callbacks: Callbacks) {
    this.options = options;
    this.config = config;
    this.callbacks = callbacks;
    this.auth = new CodexSessionAuth(config.authRevision);
  }

  failed(error: AgentError | undefined): void {
    this.auth.failed(error?.category);
  }

  ensure(
    threadId: string | undefined,
    model: string | undefined,
    mode: SessionOptions['permissionMode'],
  ): Promise<Thread | undefined> {
    if (this.closed) return Promise.reject(new Error('Codex session is closed'));
    if (this.opening) return this.opening;
    if (this.connection?.ready && !this.auth.stale) return Promise.resolve(undefined);
    this.opening = this.open(threadId, model, mode).finally(() => (this.opening = undefined));
    return this.opening;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const server = this.connection?.server;
    if (!server || this.closed) return Promise.reject(new Error('Codex session is not running'));
    return server.request<T>(method, params);
  }

  reply(id: unknown, result: unknown): void {
    if (!this.connection?.server || this.closed) throw new Error('Codex session is not running');
    this.connection.server.reply(id, result);
  }

  private async open(
    threadId: string | undefined,
    model: string | undefined,
    mode: SessionOptions['permissionMode'],
  ): Promise<Thread> {
    const previous = this.connection;
    if (previous) {
      previous.retiring = true;
      try {
        await previous.server?.close();
      } catch (error) {
        previous.retiring = false;
        throw error;
      }
      this.connection = undefined;
    }
    if (this.closed) throw new Error('Codex session is closed');
    const connection: Connection = { retiring: false, ready: false };
    this.connection = connection;
    const revision = this.auth.current;
    const o = this.options;
    try {
      connection.server = await AppServer.start({
        ...this.config,
        config: [
          ...(this.config.config ?? []),
          ...(o.sandboxMode ? [`windows.sandbox="${o.sandboxMode}"`] : []),
          'features.default_mode_request_user_input=true',
          'suppress_unstable_features_warning=true',
        ],
        cwd: o.cwd,
        ...(o.env ? { env: o.env } : {}),
        ...(o.processStarted ? { onSpawn: o.processStarted } : {}),
        onMessage: (msg) => {
          if (connection.retiring || this.closed) return;
          const error = obj(msg['error']);
          if (error) this.auth.failed(errorCategory(error));
          this.callbacks.onMessage?.(msg);
        },
        onRaw: (dir, line) => {
          o.raw({ ts: o.context.now(), dir, line });
          if (!connection.retiring && !this.closed) this.callbacks.onRaw?.(dir, line);
        },
        onExit: (code, signal) => {
          o.raw({ ts: o.context.now(), dir: 'meta', line: { event: 'exit', code, signal } });
          if (connection.ready && !connection.retiring && !this.closed)
            this.callbacks.onExit?.(code, signal);
        },
      });
      if (this.closed) throw new Error('Codex session is closed');
      const policy = codexPolicy(mode, o);
      const mcp = codexMcpConfig(o.mcpServers);
      const params = {
        cwd: o.cwd,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
        ...(model ? { model } : {}),
        ...(o.instructions ? { developerInstructions: o.instructions } : {}),
        ...(Object.keys(mcp).length ? { config: mcp } : {}),
      };
      const result = obj(
        await connection.server.request(
          threadId ? 'thread/resume' : 'thread/start',
          threadId ? { threadId, ...params, excludeTurns: true } : params,
        ),
      );
      const restored = str(obj(result?.['thread'])?.['id']);
      if (!restored || (threadId && restored !== threadId))
        throw new Error('Codex did not restore the requested thread');
      if (this.closed) throw new Error('Codex session is closed');
      this.auth.loaded(revision);
      connection.ready = true;
      return { threadId: restored, model: str(result?.['model']) ?? model ?? '' };
    } catch (error) {
      connection.retiring = true;
      await connection.server?.close();
      this.connection = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.connection) this.connection.retiring = true;
    await this.opening?.catch(() => undefined);
    await this.connection?.server?.close();
  }
}
