import { existsSync } from 'node:fs';
import { git, type AppDb, type Task } from '@skaro/core';
import type { ProjectContext } from './projects';
import { CompletionStore, criteriaRevision, type TaskResult } from './completion-store';
import { taskSections } from './task-body';
import { readLedger } from './task-stage';
import { stageIdOf } from './task-stage';

/** Import an accepted legacy result once. Never include unsubmitted work at a shared tip. */
export async function acceptedResult(
  db: AppDb,
  context: ProjectContext,
  task: Task,
): Promise<TaskResult> {
  const store = new CompletionStore(db, context.id);
  const saved = store.result(task.id);
  if (saved) {
    if (saved.criteria !== criteriaRevision(task))
      throw new Error(`${task.id}: acceptance changed; submit the result again`);
    return saved;
  }
  if (task.status !== 'review' || taskSections(task.body).criteria.some((item) => !item.done))
    throw new Error(`${task.id}: no accepted result`);
  const run = db.listRuns(context.id, task.id)[0];
  const branch = task.branch ?? run?.branch;
  if (!branch) throw new Error(`${task.id}: no recorded result branch`);
  const legacy =
    task.milestone && !task.branch
      ? readLedger(db, context.id, task.milestone).commits.findLast(
          (entry) => entry.taskId === task.id,
        )
      : undefined;
  if (!legacy && !task.branch)
    throw new Error(`${task.id}: the shared branch has no recorded task result; submit it again`);
  if (run?.worktree && existsSync(run.worktree)) {
    const dirty = (await git(run.worktree, ['status', '--porcelain'])).stdout.trim();
    if (dirty) throw new Error(`${task.id}: result checkout has uncommitted changes`);
  }
  const result: TaskResult = {
    taskId: task.id,
    branch,
    head: legacy?.commit ?? (await context.git.head(branch)),
    ...(run?.worktree ? { worktree: run.worktree } : {}),
    ...(legacy ? { sharedCheckout: true } : {}),
    criteria: criteriaRevision(task),
    message: legacy?.message ?? `${task.id}: ${task.title}`,
  };
  await git(context.root, [
    'update-ref',
    `refs/skaro/results/${task.id}/${result.head}`,
    result.head,
  ]);
  store.saveResult(result);
  return result;
}

export async function containsCommit(
  context: ProjectContext,
  base: string,
  commit: string,
): Promise<boolean> {
  const result = await git(context.root, ['merge-base', '--is-ancestor', commit, base], {
    allowFail: true,
  });
  if (result.code !== 0 && result.code !== 1)
    throw new Error(result.stderr || 'Cannot inspect merge ancestry');
  return result.code === 0;
}

export async function assertResultUnchanged(
  context: ProjectContext,
  result: TaskResult,
): Promise<void> {
  if (
    result.worktree &&
    existsSync(result.worktree) &&
    (await git(result.worktree, ['status', '--porcelain'])).stdout.trim()
  )
    throw new Error(`${result.taskId}: uncommitted changes after submission`);
  const task = await context.store.readTask(result.taskId);
  const shared =
    result.sharedCheckout ??
    (result.worktree
      ? !!stageIdOf({ projectId: context.id, taskId: result.taskId, worktree: result.worktree })
      : false);
  if (!shared && (await context.git.head(task.branch ?? result.branch)) !== result.head)
    throw new Error(`${result.taskId}: branch changed after submission; submit the result again`);
}
