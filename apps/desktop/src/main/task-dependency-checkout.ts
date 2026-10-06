import { git, type ProjectArtifacts, type Task } from '@skaro/core';
import type { TaskRunDeps } from './task-run-model';
import type { ProjectContext } from './projects';
import { acceptedResult } from './completion-results';

/** A review dependency is runnable only with its exact accepted code in the new checkout. */
export async function prepareTaskDependencies(
  ctx: { deps: Pick<TaskRunDeps, 'db'>; project: (projectId: string) => ProjectContext },
  projectId: string,
  task: Task,
  artifacts: ProjectArtifacts,
  worktree: string,
): Promise<void> {
  const dependencies = artifacts.tasks.filter(
    (item) =>
      task.dependsOn.includes(item.id) &&
      item.status === 'review' &&
      item.milestone === task.milestone,
  );
  if (!dependencies.length) return;
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim())
    throw new Error(`${task.id}: preserve uncommitted changes before preparing dependencies`);
  const results = [];
  for (const dependency of dependencies)
    results.push(await acceptedResult(ctx.deps.db, ctx.project(projectId), dependency));
  ctx.deps.db.setSetting(`completion.${projectId}.dependencies.${task.id}`, results);
  for (const head of new Set(results.map((result) => result.head))) {
    const merged = await git(worktree, ['merge', '--no-edit', head], { allowFail: true });
    if (merged.code !== 0) {
      await git(worktree, ['merge', '--abort'], { allowFail: true });
      throw new Error(
        `${task.id}: dependency integration failed: ${merged.stderr || merged.stdout}`,
      );
    }
  }
}
