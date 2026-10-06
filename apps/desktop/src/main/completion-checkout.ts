import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, MergeBlockedError, type GitService } from '@skaro/core';
import type { TaskResult } from './completion-store';

/** Combine immutable results in a private checkout. Never rebase an agent's branch. */
export async function withCompletionCheckout<T>(
  service: GitService,
  base: string,
  results: TaskResult[],
  use: (checkout: string, head: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-completion-'));
  const checkout = join(directory, 'checkout');
  let registered = false;
  try {
    await service.createDetachedWorktree(checkout, base);
    registered = true;
    for (const head of new Set(results.map((result) => result.head))) {
      if (
        (await git(checkout, ['merge-base', '--is-ancestor', head, 'HEAD'], { allowFail: true }))
          .code === 0
      )
        continue;
      const merged = await git(
        checkout,
        ['merge', '--no-edit', '-m', 'Integrate completed task results', head],
        { allowFail: true },
      );
      if (merged.code !== 0) {
        const conflicts = (await git(checkout, ['diff', '--name-only', '--diff-filter=U'])).stdout
          .split('\n')
          .filter(Boolean);
        if (!conflicts.length) throw new Error(merged.stderr || merged.stdout);
        throw new MergeBlockedError({
          blockers: ['conflicts'],
          conflicts,
          skaroChanges: [],
          baseAhead: Number(
            (await git(service.repo, ['rev-list', '--count', `${head}..${base}`])).stdout.trim(),
          ),
          stats: await service.diffStats(base, head),
        });
      }
    }
    return await use(checkout, await service.head('HEAD', checkout));
  } finally {
    // This checkout is service-owned; no agent, user data or environment is started here.
    if (registered) await service.removeDetachedWorktree(checkout);
    await rm(directory, { recursive: true, force: true });
  }
}
