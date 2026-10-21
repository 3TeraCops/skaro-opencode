// Private `opencode serve` process for one Skaro session: a free local port, basic auth
// with the generated password, and a thin HTTP/SSE client. Nothing is shared between runs.

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export interface OpenCodeServerOptions {
  binary: string;
  cwd: string;
  env?: Record<string, string>;
  /** Merged into the user's config as OPENCODE_CONFIG_CONTENT (MCP servers, instructions). */
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface OpenCodeServer {
  readonly baseUrl: string;
  readonly password: string;
  readonly child: ChildProcess;
  close(): void;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function startServer(options: OpenCodeServerOptions): Promise<OpenCodeServer> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    ...(options.config ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config) } : {}),
  };
  const child = spawn(
    options.binary,
    ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
    { cwd: options.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let output = '';
  const password = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OpenCode server did not start: ${output.slice(-400)}`)),
      30_000,
    );
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = output.match(/server password (\S+)/);
      if (!match) return;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      resolve(match[1]!);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`OpenCode server exited (${code}): ${output.slice(-400)}`));
    });
    options.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('OpenCode server start aborted'));
    });
  });

  const closed = { value: false };
  const close = (): void => {
    if (closed.value) return;
    closed.value = true;
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    }
    child.kill();
  };
  child.once('exit', () => {
    closed.value = true;
  });

  return { baseUrl: `http://127.0.0.1:${port}`, password, child, close };
}

export class OpenCodeClient {
  private readonly baseUrl: string;
  private readonly auth: string;

  constructor(server: Pick<OpenCodeServer, 'baseUrl' | 'password'>) {
    this.baseUrl = server.baseUrl;
    this.auth = `Basic ${Buffer.from(`opencode:${server.password}`).toString('base64')}`;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        authorization: this.auth,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenCode ${method} ${path}: HTTP ${response.status} ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Server-sent events of `/api/event`; yields parsed `data:` payloads. */
  async *stream(signal: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/api/event`, {
      headers: { authorization: this.auth, accept: 'text/event-stream' },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`OpenCode events: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (line) {
            try {
              yield JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            } catch {
              // Keepalive or malformed frame: the raw log already has it, skip here.
            }
          }
          index = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
