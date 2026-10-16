import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { taskRunDirectory } from './task-run-directory';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-run-directory-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('rejects missing worktrees instead of choosing the main working copy', () => {
  expect(() =>
    taskRunDirectory(root, { taskId: 'T-050', worktree: join(root, 'missing') }),
  ).toThrow('cannot continue in the main working copy');
});
it('keeps isolated and explicit in-place runs in their own working directories', async () => {
  const worktree = join(root, 'worktree');
  await mkdir(worktree);
  expect(taskRunDirectory(root, { taskId: 'T-050', worktree })).toBe(worktree);
  expect(taskRunDirectory(root, { taskId: 'T-051' })).toBe(root);
});
it('does not treat a regular file as a valid worktree', async () => {
  const worktree = join(root, 'file');
  await writeFile(worktree, 'not a directory');
  expect(() => taskRunDirectory(root, { taskId: 'T-050', worktree })).toThrow('Worktree');
});
