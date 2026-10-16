import { git } from '@skaro/core';
import type { TaskResult } from './completion-store';
import type { ProjectContext } from './projects';
import type { IntegrationStore } from './integration-store';

/** Preserve executable regression evidence of base results touching the incoming changes. */
export async function affectedBaseResults(
  context: ProjectContext,
  store: IntegrationStore,
  baseHead: string,
  results: TaskResult[],
): Promise<TaskResult[]> {
  const paths = async (result: TaskResult, baseline = baseHead) => {
    const common = (await git(context.root, ['merge-base', baseline, result.head])).stdout.trim();
    return (await git(context.root, ['diff', '--name-only', '-z', common, result.head])).stdout
      .split('\0')
      .filter((path) => path && !path.startsWith('.skaro/'));
  };
  const incoming = new Set((await Promise.all(results.map((result) => paths(result)))).flat());
  const affected = new Map<string, TaskResult>();
  for (const op of store.publications(context.id)) {
    if (op.state !== 'completed' || !op.commit) continue;
    if (
      (
        await git(context.root, ['merge-base', '--is-ancestor', op.commit, baseHead], {
          allowFail: true,
        })
      ).code !== 0
    )
      continue;
    for (const result of op.results)
      if (
        !results.some((input) => input.taskId === result.taskId) &&
        (await paths(result, op.before ?? `${op.commit}^`)).some((path) => incoming.has(path))
      )
        affected.set(result.taskId, result);
  }
  return [...affected.values()];
}
