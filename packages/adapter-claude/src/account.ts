import { execFile, spawn } from 'node:child_process';
import type { AgentStatus } from '@skaro/timeline';
import type { ClaudeRuntime } from './runtime.ts';

/** Account checks use the pinned CLI and never load the session SDK. */
export async function claudeStatus(runtime: ClaudeRuntime): Promise<AgentStatus> {
  const exe = await runtime.config.executable();
  if (!exe) return { installed: false };
  const version = (await run(exe, ['--version'], runtime.env())).stdout.trim().split(' ')[0];
  const auth = await run(exe, ['auth', 'status', '--json'], runtime.env());
  try {
    const status = JSON.parse(auth.stdout) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
    };
    return {
      installed: true,
      version,
      authenticated: status.loggedIn === true,
      account: status.email ?? status.subscriptionType,
    };
  } catch {
    return { installed: true, version, authenticated: false };
  }
}

/** The CLI owns browser login and credentials. */
export async function loginClaude(runtime: ClaudeRuntime): Promise<void> {
  const exe = await runtime.requireExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ['auth', 'login'], {
      env: runtime.env(),
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`claude auth login exited with ${code}`)),
    );
  });
}

function run(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(file, args, { env, windowsHide: true, timeout: 30_000 }, (error, stdout) =>
      resolve({ stdout: String(stdout), code: error ? 1 : 0 }),
    );
  });
}
