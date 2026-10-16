import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppDb } from '@skaro/core';

interface OwnedProcess {
  pid: number;
  birth: string;
  platform: string;
}
const execute = promisify(execFile);

/** A PID alone is unsafe after a restart: verify the OS creation identity before stopping it. */
function birth(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid agent process id');
  if (process.platform === 'win32') {
    // A reused PID may belong to a process that hides its start time: it is not the recorded one.
    const script = `try { $start = [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime; if ($null -ne $start) { $start.ToUniversalTime().Ticks }; exit 0 } catch [System.ArgumentException] { exit 0 } catch { Write-Error $_; exit 1 }`;
    return (
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      }).trim() || undefined
    );
  }
  try {
    return (
      execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 10000,
      }).trim() || undefined
    );
  } catch (error) {
    if ((error as { status?: number }).status === 1) return undefined;
    throw error;
  }
}

/** Durable ownership of task agent processes, including recovery after a main-process crash. */
export class TaskRunProcesses {
  private readonly db: AppDb;
  constructor(db: AppDb) {
    this.db = db;
  }
  private key(runId: string): string {
    return `run.${runId}.processes`;
  }

  started(runId: string, pid: number, allowExited = false): void {
    const identity = birth(pid);
    if (!identity && allowExited) return;
    if (!identity) throw new Error('The agent process exited before ownership was recorded');
    const records = this.db.getSetting<OwnedProcess[] | null>(this.key(runId), []) ?? [];
    this.db.setSetting(this.key(runId), [
      ...records,
      { pid, birth: identity, platform: process.platform },
    ]);
  }

  async stop(runId: string): Promise<void> {
    const setting = this.key(runId);
    const records = this.db.getSetting<OwnedProcess[] | null>(setting, []) ?? [];
    for (const record of records) {
      if (record.platform !== process.platform)
        throw new Error('Agent process ownership belongs to another OS');
      if (birth(record.pid) !== record.birth) continue;
      try {
        if (process.platform === 'win32') {
          await execute('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 10000,
          });
        } else {
          // The adapters spawn a separate process group for each task agent.
          process.kill(-record.pid, 'SIGKILL');
        }
      } catch (error) {
        if (birth(record.pid) === record.birth) throw error;
      }
      for (let n = 0; birth(record.pid) === record.birth; n++) {
        if (n === 20)
          throw new Error('The old agent process is still running. Handoff is blocked.');
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
    this.db.setSetting(setting, []);
  }
}
