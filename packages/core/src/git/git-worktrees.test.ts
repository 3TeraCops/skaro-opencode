import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dir, service, write, taskWithChange } from './git-test-support.ts';
import { GitService } from './git.ts';

describe('worktrees', () => {
  it('allocates independent task and publication worktrees concurrently across services', async () => {
    const other = new GitService(service.repo);
    const paths = Array.from({ length: 4 }, (_, i) => join(dir, `parallel-${i}`));
    await Promise.all(
      paths.map((path, i) =>
        i === 3
          ? other.createDetachedWorktree(path, 'main')
          : (i % 2 ? other : service).createWorktree({
              path,
              branch: `skaro/parallel-${i}`,
              base: 'main',
            }),
      ),
    );
    for (const [i, path] of paths.entries()) {
      expect(existsSync(path)).toBe(true);
      expect(await service.currentBranch(path)).toBe(i === 3 ? undefined : `skaro/parallel-${i}`);
    }
    await Promise.all(
      paths.map((path, i) =>
        i === 3 ? other.removeDetachedWorktree(path) : service.removeWorktree(path),
      ),
    );
    expect(paths.some(existsSync)).toBe(false);
  });
  it('creates a branch from base, reuses it, and removes both', async () => {
    const path = join(dir, 'wt1');
    await service.createWorktree({ path, branch: 'skaro/T-001-a', base: 'main' });
    expect(await service.currentBranch(path)).toBe('skaro/T-001-a');
    await service.removeWorktree(path);
    expect(existsSync(path)).toBe(false);
    expect(await service.branchExists('skaro/T-001-a')).toBe(true);

    await service.createWorktree({ path, branch: 'skaro/T-001-a', base: 'main' });
    expect(await service.currentBranch(path)).toBe('skaro/T-001-a');
    await service.removeWorktree(path, { deleteBranch: 'skaro/T-001-a' });
    expect(await service.branchExists('skaro/T-001-a')).toBe(false);
  });

  it('retains uncommitted work and tolerates a missing worktree', async () => {
    const path = await taskWithChange({ 'a.txt': 'a\n' });
    await write(path, 'dirty.txt', 'x');
    await expect(service.removeWorktree(path)).rejects.toThrow('untracked');
    expect(existsSync(path)).toBe(true);
    await expect(service.removeWorktree(join(dir, 'missing'))).resolves.toBeUndefined();
  });
});
