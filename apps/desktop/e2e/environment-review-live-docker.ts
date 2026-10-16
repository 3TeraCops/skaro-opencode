import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const label = (name: string) => `label=com.docker.compose.project=${name}`;

async function docker(args: string[]): Promise<string> {
  return (await exec('docker', args, { windowsHide: true, timeout: 30_000 })).stdout.trim();
}

export async function runningContainers(name: string): Promise<string[]> {
  return (await docker(['ps', '-q', '--filter', label(name)])).split(/\s+/).filter(Boolean);
}

export async function volumeIdentity(name: string): Promise<string[]> {
  const names = (await docker(['volume', 'ls', '-q', '--filter', label(name)]))
    .split(/\s+/)
    .filter(Boolean);
  if (!names.length)
    throw new Error(`${name}: existing task data is missing; a live check must never clone it`);
  const volumes = JSON.parse(await docker(['volume', 'inspect', ...names])) as {
    Name: string;
    CreatedAt: string;
  }[];
  return volumes.map((volume) => `${volume.Name}:${volume.CreatedAt}`).sort();
}

export async function assertIdleLiveDocker(name: string): Promise<void> {
  if ((await runningContainers(name)).length)
    throw new Error(
      `${name}: services are already in use; the live check will not stop their owner`,
    );
  // Containers may have been removed by their owner; actual saved volumes are sufficient.
  // The normal project launch can recreate services without copying another database.
  await volumeIdentity(name);
}

/** Failure recovery stops only the two explicitly selected existing Compose projects. */
export async function stopLiveDocker(names: string[]): Promise<void> {
  for (const name of names) {
    const ids = await runningContainers(name);
    if (ids.length) await docker(['stop', ...ids]);
  }
}
