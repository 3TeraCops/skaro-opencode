import { access, mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactFiles } from './files.ts';
import { nextNumber } from './conversion.ts';

export async function assertReservation(
  files: ArtifactFiles,
  directory: string,
  id: string,
  pattern: RegExp,
) {
  if (!pattern.test(id)) throw new Error(`Invalid reserved identity: ${id}`);
  await access(join(files.dir, directory, id));
}

export async function reserveMilestoneId(
  files: ArtifactFiles,
  existing: string[],
): Promise<string> {
  const directory = join(files.dir, '.milestone-ids');
  await mkdir(directory, { recursive: true });
  let number = nextNumber([...existing, ...(await readdir(directory))], /^M(\d+)$/);
  for (;;) {
    const id = `M${String(number++).padStart(2, '0')}`;
    try {
      const file = await open(join(directory, id), 'wx');
      await file.close();
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
