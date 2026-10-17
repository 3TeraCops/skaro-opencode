// Copies existing artifacts only: no generated documents, seeded tasks or mocked services.
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectContext } from './projects';

const source = process.env['SKARO_CACHE_PROJECT_ROOT'];

async function removeSnapshot(root: string): Promise<void> {
  const inside = relative(resolve(tmpdir()), resolve(root));
  if (
    !inside ||
    isAbsolute(inside) ||
    inside.startsWith('..') ||
    !inside.startsWith('skaro-cache-live-')
  )
    throw new Error(`Refuse cleanup outside the temporary snapshot: ${root}`);
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}

it.skipIf(!source)(
  'reuses real artifacts until an external file notification invalidates them',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'skaro-cache-live-'));
    let context: ProjectContext | undefined;
    try {
      await cp(join(source!, '.skaro'), join(root, '.skaro'), { recursive: true });
      context = new ProjectContext(
        'cache-live',
        root,
        () => undefined,
        () => ({}),
      );
      const initial = await context.load();
      expect(initial.tasks.length).toBeGreaterThan(0);
      expect(await context.load()).toBe(initial);
      // Rewriting the original bytes exercises the real filesystem watcher without
      // inventing or changing the contents of a project document.
      const doc = initial.architecture ?? initial.brief ?? initial.docs[0];
      expect(doc, 'A real project document is required').toBeDefined();
      await copyFile(join(source!, doc!.path), join(root, doc!.path));
      await expect
        .poll(async () => (await context!.load()) !== initial, { timeout: 15_000 })
        .toBe(true);
      const refreshed = await context.load();
      expect(refreshed).toEqual(initial);
      expect(await context.load()).toBe(refreshed);
      context.invalidate();
      const afterOwnWrite = await context.load();
      expect(afterOwnWrite).not.toBe(refreshed);
      expect(afterOwnWrite).toEqual(initial);
    } finally {
      context?.close();
      await removeSnapshot(root);
    }
  },
  30_000,
);
