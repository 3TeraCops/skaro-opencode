import { mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactFiles } from './files.ts';
import { nextNumber } from './conversion.ts';

const DIRECTORY = '.task-ids';

/** Permanent reservations survive task deletion and concurrent ArtifactStore instances. */
export async function reserveTaskId(files: ArtifactFiles, existing: string[]): Promise<string> {
  const directory = join(files.dir, DIRECTORY);
  await mkdir(directory, { recursive: true });
  const reserved = await readdir(directory);
  let number = nextNumber([...existing, ...reserved, ...files.reservedTaskIds()], /^T-(\d+)$/);
  for (;;) {
    const id = `T-${String(number++).padStart(3, '0')}`;
    try {
      const reservation = await open(join(directory, id), 'wx');
      await reservation.close();
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Older tasks get a reservation before their file can disappear. */
export async function retainTaskId(files: ArtifactFiles, id: string): Promise<void> {
  if (!/^T-\d+$/.test(id)) throw new Error(`Invalid task id: ${id}`);
  const directory = join(files.dir, DIRECTORY);
  await mkdir(directory, { recursive: true });
  const reservation = await open(join(directory, id), 'a');
  await reservation.close();
}
