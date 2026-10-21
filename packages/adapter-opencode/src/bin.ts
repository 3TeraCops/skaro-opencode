// Locates the OpenCode CLI. Skaro runs the binary the desktop app already ships or the one on
// PATH; nothing is downloaded (OpenCode v2 is not published as a pinnable npm package).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let cached: string | null | undefined;

function newestDirectory(parent: string): string | undefined {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  } catch {
    return undefined;
  }
}

function candidates(): string[] {
  const home = homedir();
  const local = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
  const roaming = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming');
  const list = [
    join(local, 'Programs', '@opencodedesktop', 'resources', 'opencode-cli.exe'),
    join(local, 'Programs', 'opencode', 'opencode.exe'),
    join(local, 'Programs', '@opencode', 'opencode.exe'),
    join(roaming, 'ai.opencode.desktop', 'cli', 'opencode-cli.exe'),
  ];
  const cliRoot = join(roaming, 'ai.opencode.desktop', 'cli');
  const version = newestDirectory(cliRoot);
  if (version) list.push(join(cliRoot, version, 'opencode-cli.exe'));
  return list;
}

function onPath(): string | undefined {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['opencode'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && existsSync(line));
  } catch {
    return undefined;
  }
}

export async function resolveOpenCodeBinary(): Promise<string | undefined> {
  if (cached !== undefined) return cached ?? undefined;
  const fromEnv = process.env['OPENCODE_BIN'];
  if (fromEnv && existsSync(fromEnv)) return (cached = fromEnv);
  const found = candidates().find((path) => existsSync(path)) ?? onPath();
  cached = found ?? null;
  return found;
}

export function openCodeVersion(): string | undefined {
  const binary = cached;
  if (!binary) return undefined;
  try {
    return execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return undefined;
  }
}

/** The folder the user's own OpenCode settings live in (D-25). */
export function openCodeConfigDir(): string {
  return process.env['OPENCODE_CONFIG_DIR'] ?? join(homedir(), '.config', 'opencode');
}
