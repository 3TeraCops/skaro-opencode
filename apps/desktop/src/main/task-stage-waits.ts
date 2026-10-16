import type { ProjectArtifacts, Task } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { stageIdOf } from './task-stage';

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
