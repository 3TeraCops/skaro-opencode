import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { checkCommand, type CheckShell } from './check-command.ts';

const OUTPUT_LIMIT = 16_384;

/** Runs the owner's command in a shell; a failure carries the end of its output. */
export function runShell(
  command: string,
  options: {
    cwd: string;
    env?: Record<string, string>;
    label?: string;
    shell?: CheckShell;
    timeoutMs?: number;
    signal?: AbortSignal;
    processStarted?: (pid: number) => void;
    output?: (text: string) => void;
  },
): Promise<void> {
  const label = options.label ? `${options.label}: ` : '';
  return new Promise<void>((resolve, reject) => {
    const invocation = checkCommand(command, options.shell);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      shell: invocation.shell,
      windowsHide: true,
      detached: !!options.processStarted && process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
      options.output?.(output);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => reject(new Error(`${label}${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}${signal ?? `exit ${code}`}\n${output.trim()}`));
    });
    try {
      if (child.pid) options.processStarted?.(child.pid);
    } catch (error) {
      child.kill();
      reject(error);
    }
  });
}

/** Waits until the address answers 2xx: the services run and their dependencies answer. */
export async function waitReady(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  for (;;) {
    options.signal?.throwIfAborted();
    let last: string;
    try {
      const timeout = AbortSignal.timeout(5_000);
      const response = await fetch(url, {
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error(`The environment is not ready at ${url}: ${last}`);
    await delay(options.intervalMs ?? 2_000, undefined, { signal: options.signal });
  }
}
