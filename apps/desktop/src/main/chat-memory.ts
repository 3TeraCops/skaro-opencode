import type { ChatEngine } from './chat-engine';
import { canRetireHistory } from './history-memory';

/** Saved history remains on disk; only idle native sessions and reconstructed copies retire. */
export async function retireChatHistories(ctx: ChatEngine, protectedId: string): Promise<void> {
  let bytes = 0;
  for (const live of ctx.live.values()) bytes += live.memoryBytes;
  if (bytes < 32 * 1024 * 1024 && ctx.live.size <= 6) return;
  for (const [id, live] of ctx.live) {
    if (
      id === protectedId ||
      live.attaching ||
      live.planningSending ||
      live.planningTimer ||
      !canRetireHistory(live.timeline)
    )
      continue;
    if (ctx.planning.store(live).current()) continue;
    await live.proposalQueue;
    await live.deliveryQueue;
    if (!canRetireHistory(live.timeline)) continue;
    await ctx.sessions.detach(live);
    if (live.log)
      await new Promise<void>((resolve, reject) =>
        live.log!.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    ctx.live.delete(id);
    bytes -= live.memoryBytes;
    if (bytes < 32 * 1024 * 1024 && ctx.live.size <= 6) break;
  }
}
