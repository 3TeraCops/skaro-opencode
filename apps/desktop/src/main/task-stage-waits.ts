import type { ProjectArtifacts, Task, RunRecord } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { stageIdOf } from './task-stage';

/** One pass for a board refresh; no per-card run queries or scans of every other task. */
export function stageWaitIndex(
  ctx: TaskRunEngine,
  projectId: string,
  artifacts: ProjectArtifacts,
  runtime: ReadonlyMap<string, { state: string }>,
  runs: ReadonlyMap<string, RunRecord>,
): Map<string, string> {
  const runsWithActive = new Map(runs);
  for (const task of artifacts.tasks) {
    const active = ctx.active.get(key(projectId, task.id));
    if (active) runsWithActive.set(task.id, active.run);
  }
  return stageWaits(artifacts.tasks, runtime, runsWithActive);
}

export function stageWaits(
  tasks: readonly Task[],
  runtime: ReadonlyMap<string, { state: string }>,
  runs: ReadonlyMap<string, RunRecord>,
): Map<string, string> {
  const stages = new Map<string, string>();
  const busy = new Map<string, string[]>();
  for (const task of tasks) {
    const run = runs.get(task.id);
    const stage = run && stageIdOf(run);
    if (!stage) continue;
    stages.set(task.id, stage);
    if (
      task.status === 'in_progress' ||
      ['running', 'waiting'].includes(runtime.get(task.id)?.state ?? '')
    ) {
      const ids = busy.get(stage) ?? [];
      // Only the first two are needed to choose the first writer other than this task.
      if (ids.length < 2) ids.push(task.id);
      busy.set(stage, ids);
    }
  }
  const waits = new Map<string, string>();
  for (const [id, stage] of stages) {
    const after = busy.get(stage)?.find((other) => other !== id);
    if (after) waits.set(id, after);
  }
  return waits;
}

/** Legacy shared checkouts remain mutually exclusive until their work is finished. */
export function waitsInStage(
  ctx: TaskRunEngine,
  projectId: string,
  task: Task,
  artifacts: ProjectArtifacts,
  runtime: ReadonlyMap<string, { state: string }>,
): { after?: string } {
  const run =
    ctx.active.get(key(projectId, task.id))?.run ?? ctx.deps.db.listRuns(projectId, task.id)[0];
  const stageId = run && stageIdOf(run);
  if (!stageId) return {};
  const busy = artifacts.tasks.find((item) => {
    const other =
      ctx.active.get(key(projectId, item.id))?.run ?? ctx.deps.db.listRuns(projectId, item.id)[0];
    return (
      item.id !== task.id &&
      other &&
      stageIdOf(other) === stageId &&
      (item.status === 'in_progress' ||
        ['running', 'waiting'].includes(runtime.get(item.id)?.state ?? ''))
    );
  });
  return busy ? { after: busy.id } : {};
}
