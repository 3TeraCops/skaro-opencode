import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Timeline } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import { LiveChat } from './chat-model';
import { serializeChatMutation } from './chat-mutations';
import { closeSessionLog } from './close-session-log';
import { historyReads } from './history-read-service';
import { TaskReplanJournal } from './task-replan-journal';
import { blockOwnerMessages } from './owner-commands';

export async function clearChat(ctx: ChatEngine, projectId: string, chatId: string): Promise<void> {
  const saved = ctx.deps.db.getChat(chatId);
  if (!saved || saved.projectId !== projectId) throw new Error('The chat is not found');
  const unblock = blockOwnerMessages(projectId, chatId);
  try {
    const live = await ctx.history.restore(projectId, chatId);
    await serializeChatMutation(live, async () => {
      if (
        live.timeline.state.status !== 'idle' ||
        live.attaching ||
        live.planningSending ||
        ctx.deps.db.commands.pending().some((command) => command.owner === `${projectId}:${chatId}`)
      )
        throw new Error('Wait for the agent to finish or stop it before clearing the chat.');
      if (
        new TaskReplanJournal(ctx.deps.db, projectId)
          .list()
          .some(
            (decision) =>
              decision.chatId === chatId && !['applied', 'reverted'].includes(decision.phase),
          )
      )
        throw new Error('Finish the confirmed task replan before clearing the chat.');
      if (
        live.timeline.state.items.some(
          (item) => item.kind === 'proposal' && item.state === 'accepted',
        )
      )
        throw new Error('Finish applying confirmed changes before clearing the chat.');
      ctx.planningContinuation.stop(live, 'Chat history cleared by the owner.');
      await ctx.sessions.detach(live);
      await closeSessionLog(live.log);
      const logPath = join('chats', projectId, `${Date.now()}-${randomUUID()}.jsonl`);
      const commands = ctx.deps.db.commands.forOwner(`${projectId}:${chatId}`);
      ctx.deps.db.clearChatHistory(chatId, logPath);
      for (const command of commands)
        ctx.deps.emit('command.changed', { ...command, state: 'cancelled', error: undefined });
      const fresh = new LiveChat(projectId, ctx.deps.db.getChat(chatId)!, new Timeline());
      // Keep sequence numbers monotonic for renderer/read-model updates.
      fresh.seq = live.seq + 1;
      ctx.live.set(chatId, fresh);
      await historyReads().reset(`${projectId}:chat:${chatId}`, fresh.seq, fresh.timeline.state);
      ctx.listChanged(projectId, chatId);
    });
  } finally {
    unblock();
  }
}
