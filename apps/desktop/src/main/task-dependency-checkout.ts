import {
  git,
  indexTasks,
  pendingDependencies,
  type ProjectArtifacts,
  type Task,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import type { ProjectContext } from './projects';
import type { TaskRunDeps } from './task-run-model';
import { acceptedResult, assertResultUnchanged } from './completion-results';
import {
  assertDependencyVersions,
  dependencySnapshot,
  preparedDependencies,
} from './completion-dependencies';
import { CompletionStore, type TaskResult } from './completion-store';

/** A review dependency is runnable only with its exact accepted code in the new checkout. */
export async function prepareTaskDependencies(
  ctx: {
    deps: Pick<TaskRunDeps, 'db'>;
    project: (id: string) => ProjectContext;
    integrations: Pick<TaskRunEngine['integrations'], 'service'>;
  },
  projectId: string,
  task: Task,
  artifacts: ProjectArtifacts,
  worktree: string,
): Promise<void> {
  const pending = pendingDependencies(task, indexTasks(artifacts.tasks));
  if (!task.unblocked && pending.length)
    throw new Error(`${task.id}: dependencies are not ready: ${pending.join(', ')}`);
  const dependencies = artifacts.tasks.filter(
    (item) => task.dependsOn.includes(item.id) && item.status === 'review',
  );
  if (!dependencies.length) return;
  const results: TaskResult[] = [];
  for (const dependency of dependencies)
    results.push(await acceptedResult(ctx.deps.db, ctx.project(projectId), dependency));
  for (const result of results) await assertResultUnchanged(ctx.project(projectId), result);
  const store = new CompletionStore(ctx.deps.db, projectId);
  const validateInputs = (current: ProjectArtifacts) =>
    assertDependencyVersions(current, dependencySnapshot(results), store, task.id);
  validateInputs(artifacts);
  const recorded = new Map(
    preparedDependencies(ctx.deps.db, projectId, task.id).map((result) => [result.taskId, result]),
  );
  for (const result of results) recorded.set(result.taskId, result);
  const saveInputs = () =>
    ctx.deps.db.setSetting(`completion.${projectId}.dependencies.${task.id}`, [
      ...recorded.values(),
    ]);
  dependencySnapshot([...recorded.values()]);
  const missing = [];
  for (const result of results)
    if (
      (
        await git(worktree, ['merge-base', '--is-ancestor', result.head, 'HEAD'], {
          allowFail: true,
        })
      ).code !== 0
    )
      missing.push(result);
  if (!missing.length) {
    const context = ctx.project(projectId);
    context.invalidate();
    validateInputs(await context.load());
    saveInputs();
    return;
  }
  // Only a merge needs a clean checkout: a run continued by another agent keeps its work.
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim())
    throw new Error(`${task.id}: preserve uncommitted changes before preparing dependencies`);
  const context = ctx.project(projectId);
  const before = await context.git.head('HEAD', worktree);
  const op = await ctx.integrations.service.prepare({
    projectId,
    taskId: task.id,
    purpose: 'dependencies',
    base: before,
    results: missing,
    checks: artifacts.config.checks,
  });
  for (const result of results) await assertResultUnchanged(context, result);
  context.invalidate();
  validateInputs(await context.load());
  if (
    (await context.git.head('HEAD', worktree)) !== before ||
    (await git(worktree, ['status', '--porcelain'])).stdout.trim()
  )
    throw new Error(`${task.id}: checkout changed during dependency integration`);
  await git(worktree, ['merge', '--ff-only', op.head]);
  saveInputs();
  op.state = 'applied';
  ctx.integrations.service.save(op);
}
