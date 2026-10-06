import type { CompletionOperation } from './completion-store';
import type { TaskMergeHooks } from './task-merge-refresh';
import type { TaskRunDeps } from './task-run-model';
import { closeMergeCards } from './task-merge-result';
import { stageIdOf } from './task-stage';

/** Feed and environment updates project the durable completion, they never own it. */
export async function projectCompletion(
  hooks: TaskMergeHooks & { deps: TaskRunDeps },
  projectId: string,
  operation: CompletionOperation,
  unblocked: string[],
): Promise<void> {
  for (const result of operation.results) {
    const active = hooks
      .active()
      .find((run) => run.projectId === projectId && run.taskId === result.taskId);
    hooks.changed(projectId, result.taskId);
    const run = hooks.deps.db.listRuns(projectId, result.taskId)[0];
    const owner = run && stageIdOf(run);
    if (!owner)
      void hooks
        .removeEnvironment(projectId, result.taskId)
        .catch((error: unknown) => console.error(String(error)));
    else {
      const tasks = (await hooks.project(projectId).load()).tasks.filter(
        (task) => task.milestone === owner && !task.archived,
      );
      if (tasks.every((task) => ['done', 'cancelled'].includes(task.status)))
        void hooks
          .removeEnvironment(projectId, owner)
          .catch((error: unknown) => console.error(String(error)));
    }
    if (!active) continue;
    active.merged = { commit: operation.commit!, base: operation.base };
    closeMergeCards(active, hooks);
    hooks.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-merged-${operation.id}`,
        turnId: active.timeline.state.turns.at(-1)?.id ?? '',
        kind: 'notice',
        level: 'info',
        code: 'merged',
        text: operation.base,
        status: 'done',
        ...(operation.before
          ? { merge: { before: operation.before, strategy: operation.strategy } }
          : {}),
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'merged', ref: operation.commit! },
      },
    });
    const cleanup = async () => {
      await hooks.detach(active);
      hooks.setRuntime(projectId, active.taskId, 'idle');
    };
    if (active.session && active.timeline.state.status !== 'idle') active.afterTurn = cleanup;
    else await cleanup();
  }
  for (const taskId of unblocked) hooks.changed(projectId, taskId);
  await hooks.launchUnblocked(projectId, unblocked);
  hooks.deps.notify?.('merged', operation.results.map((result) => result.taskId).join(', '));
}
