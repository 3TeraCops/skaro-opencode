import type { TaskRunEngine } from './task-run-engine';
import { canRetireHistory } from './history-memory';

export async function retireTaskHistories(ctx: TaskRunEngine, protectedKey: string): Promise<void> {
  let bytes = 0;
  for (const active of ctx.active.values()) bytes += active.memoryBytes;
  if (bytes < 32 * 1024 * 1024 && ctx.active.size <= 6) return;
  for (const [key, active] of ctx.active) {
    if (
      key === protectedKey ||
      active.attaching ||
      active.switching ||
      active.afterTurn ||
      active.release ||
      active.operations.size ||
      !canRetireHistory(active.timeline)
    )
      continue;
    if (ctx.scheduling.holdsSlot(active.projectId, active.taskId)) continue;
    await ctx.sessions.detach(active);
    await ctx.history.drain(active);
    if (active.log)
      await new Promise<void>((resolve, reject) =>
        active.log!.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    ctx.active.delete(key);
    bytes -= active.memoryBytes;
    if (bytes < 32 * 1024 * 1024 && ctx.active.size <= 6) break;
  }
}
