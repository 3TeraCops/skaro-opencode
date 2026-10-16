import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git } from './git.ts';
import { repo, service, write, commit, taskWithChange, log } from './git-test-support.ts';

const options = () => ({
  base: 'main',
  branch: 'skaro/T-001-a',
  strategy: 'squash' as const,
  message: 'merge matching additions',
});

it.each(['squash', 'merge', 'rebase'] as const)(
  'publishes identical untracked additions with %s without rewriting files or unrelated staging',
  async (strategy) => {
    const files = {
      'design/Навыки [1].html': '<html>baseline</html>\n',
      'design/assets/logo.svg': '<svg/>\n',
    };
    const worktree = await taskWithChange(files);
    for (const [path, content] of Object.entries(files)) await write(repo, path, content);
    const path = Object.keys(files)[0]!;
    const before = await stat(join(repo, path));
    await write(repo, 'README.md', '# staged\n');
    await git(repo, ['add', 'README.md']);
    await write(repo, 'README.md', '# unstaged\n');
    const staged = (await git(repo, ['diff', '--cached', '--binary'])).stdout;
    const unstaged = (await git(repo, ['diff', '--binary'])).stdout;
    expect((await service.checkMerge('main', options().branch)).blockers).toEqual([]);
    const result = await service.merge({ ...options(), strategy, worktree });
    expect(await service.head()).toBe(result.commit);
    expect((await git(repo, ['diff', '--cached', '--binary'])).stdout).toBe(staged);
    expect((await git(repo, ['diff', '--binary'])).stdout).toBe(unstaged);
    expect((await stat(join(repo, path))).mtimeMs).toBe(before.mtimeMs);
    for (const [path, content] of Object.entries(files)) {
      expect(await readFile(join(repo, path), 'utf8')).toBe(content);
      expect((await git(repo, ['show', `HEAD:${path}`])).stdout).toBe(content);
    }
    expect((await git(repo, ['ls-files', '--others', '-z'])).stdout).toBe('');
  },
  15_000,
);

it('adopts identical ignored files that the task explicitly adds', async () => {
  await commit(repo, 'ignore runtime', { '.gitignore': 'design/\n' });
  const worktree = await taskWithChange({ 'feature.txt': 'feature\n' });
  await write(worktree, 'design/baseline.svg', '<svg/>\n');
  await git(worktree, ['add', '-f', 'design/baseline.svg']);
  await git(worktree, ['commit', '-qm', 'add baseline']);
  await write(repo, 'design/baseline.svg', '<svg/>\n');
  await service.merge(options());
  expect((await git(repo, ['status', '--porcelain'])).stdout).toBe('');
  expect(await readFile(join(repo, 'design/baseline.svg'), 'utf8')).toBe('<svg/>\n');
});

it('keeps staged edits blocked even when working content matches the incoming file', async () => {
  await taskWithChange({ 'README.md': '# task\n' });
  await write(repo, 'README.md', '# task\n');
  await git(repo, ['add', 'README.md']);
  expect((await service.checkMerge('main', options().branch)).localChanges).toEqual(['README.md']);
  await expect(service.merge(options())).rejects.toThrow('dirty_base');
});

it('blocks differing bytes even when Git attributes normalize them to the same blob', async () => {
  await commit(repo, 'normalize text', { '.gitattributes': '*.txt text eol=lf\n' });
  await taskWithChange({ 'feature.txt': 'feature\n' });
  await write(repo, 'feature.txt', 'feature\r\n');
  expect((await service.checkMerge('main', options().branch)).localChanges).toEqual([
    'feature.txt',
  ]);
  await expect(service.merge(options())).rejects.toThrow('dirty_base');
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature\r\n');
});

it('rechecks matching additions at publication and preserves concurrent edits', async () => {
  await taskWithChange({ 'feature.txt': 'feature\n' });
  await write(repo, 'feature.txt', 'feature\n');
  await expect(
    service.merge({
      ...options(),
      prepared: async () => write(repo, 'feature.txt', 'late owner edit\n'),
    }),
  ).rejects.toThrow('Local changes would be overwritten');
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('late owner edit\n');
  expect(await log(repo)).toEqual(['init']);
  expect((await git(repo, ['diff', '--cached'])).stdout).toBe('');
});

it('retains matching untracked files and their index state when ref publication fails', async () => {
  await taskWithChange({ 'feature.txt': 'feature\n' });
  await write(repo, 'feature.txt', 'feature\n');
  await expect(
    service.merge({
      ...options(),
      prepared: async () => write(repo, '.git/refs/heads/main.lock', 'external Git lock'),
    }),
  ).rejects.toThrow('update-ref');
  expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n');
  expect((await git(repo, ['ls-files', '--others', '-z'])).stdout).toBe('feature.txt\0');
  expect((await git(repo, ['diff', '--cached'])).stdout).toBe('');
  expect(await log(repo)).toEqual(['init']);
});
