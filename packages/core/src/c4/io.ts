import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const pending = new Map<string, Promise<unknown>>();

/** Serialize architecture reads/writes in this service, including interrupted transaction recovery. */
export async function withC4Lock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pending.set(root, current);
  try {
    return await current;
  } finally {
    if (pending.get(root) === current) pending.delete(root);
  }
}

export async function readC4File(root: string, path: string): Promise<string | null> {
  const file = await c4Path(root, path);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Refuse traversal and links pointing outside the actual project, including new descendants. */
export async function c4Path(root: string, path: string): Promise<string> {
  if (
    isAbsolute(path) ||
    path.split(/[\\/]/).some((s) => s === '..' || s === '.') ||
    path.includes('\\')
  )
    throw new Error(`C4: unsafe path ${path}`);
  const realRoot = await realpath(root);
  const target = join(realRoot, '.skaro', path);
  let existing = target;
  while (true) {
    try {
      const actual = await realpath(existing);
      const rel = relative(realRoot, actual);
      if (rel.startsWith('..') || isAbsolute(rel))
        throw new Error(`C4: path escapes project ${path}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  return target;
}

export async function writeC4File(root: string, path: string, body: string): Promise<void> {
  const target = await c4Path(root, path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
