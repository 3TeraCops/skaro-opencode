import type { TaskReplanProgress, TaskReplanProposal } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { allocateReplan, applyReplanWrites } from './task-replan-apply';
import { taskFiles } from './task-replan-files';
import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';
import { taskReplanLockKey } from './project-task-mutations';
import { revertReplanWrites } from './task-replan-revert';
import { replanProgress, reportReplanFailure, reportReplanResult } from './task-replan-feedback';

/** One durable operation owns the graph through apply, reversal, failure and recovery. */
export async function resumeTaskReplan(
  ctx: ChatEngine,
  live: LiveChat,
  decision: TaskReplanDecision,
): Promise<void> {
  const { db } = ctx.deps;
  const lockKey = taskReplanLockKey(live.projectId);
  if (decision.phase === 'applied' || decision.phase === 'reverted') {
    if (db.getSetting(lockKey, null) === decision.item.id) db.setSetting(lockKey, null);
    reportReplanResult(ctx, live, decision);
    return;
  }
  const lock = db.getSetting(lockKey, null);
  if (lock && lock !== decision.item.id) throw new Error('Another replan is still recovering.');
  db.setSetting(lockKey, decision.item.id);
  const journal = new TaskReplanJournal(db, live.projectId);
  const operation = decision.phase === 'reverting' ? 'revert' : 'apply';
  const progress = (value: Omit<TaskReplanProgress, 'operation'>) => {
    replanProgress(ctx, live, decision, { ...value, operation });
    journal.save(decision);
  };
  delete decision.error;
  const previous = decision.item.result?.replan;
  progress(
    previous?.operation === operation
      ? {
          writes: previous.writes,
          totalWrites: previous.totalWrites,
          removes: previous.removes,
          totalRemoves: previous.totalRemoves,
        }
      : { writes: 0, totalWrites: 0, removes: 0, totalRemoves: 0 },
  );
  try {
    if (operation === 'revert') await revertReplanWrites(ctx, decision, progress);
    else {
      await allocateReplan(ctx, decision);
      await applyReplanWrites(ctx, decision, progress);
      const tasks = (await ctx.project(live.projectId).store.load()).tasks;
      decision.afterFiles = await taskFiles(
        ctx.project(live.projectId).root,
        tasks.filter((t) => decision.writes.some((w) => w.id === t.id)),
      );
    }
    const proposal = decision.item.proposal as TaskReplanProposal;
    decision.phase = operation === 'revert' ? 'reverted' : 'applied';
    decision.item = {
      ...decision.item,
      state: decision.phase,
      endedAt: Date.now(),
      result: {
        ...decision.item.result,
        tasks: proposal.tasks.map((t) => ({
          id: decision.ids[t.ref]!,
          title: t.title,
          ref: t.ref,
        })),
      },
    };
    journal.save(decision);
  } catch (error) {
    decision.error = error instanceof Error ? error.message : String(error);
    replanProgress(ctx, live, decision, {
      ...decision.item.result!.replan!,
      error: decision.error,
    });
    journal.save(decision);
    ctx.project(live.projectId).invalidate();
    reportReplanFailure(ctx, live, decision.item, operation, error, true);
    throw error;
  }
  db.setSetting(lockKey, null);
  reportReplanResult(ctx, live, decision);
}
