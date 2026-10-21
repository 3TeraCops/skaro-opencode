import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Timeline } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';
import { ActiveRun } from './task-run-model';
import { key } from './task-run-helpers';
import { serializeTaskMutation } from './project-task-mutations';
import { closeSessionLog } from './close-session-log';
import { historyReads } from './history-read-service';
import { blockOwnerMessages } from './owner-commands';

export async function clearTaskChat(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
): Promise<void> {
  const unblock = blockOwnerMessages(projectId, taskId);
  try {
    await serializeTaskMutation(ctx.project(projectId), async () => {
      const active = await ctx.history.restore(projectId, taskId);
      if (!active) return;
      const commands = ctx.deps.db.commands.forOwner(`${projectId}:${taskId}`);
      const operations = ctx.integrations.store
        .all(projectId)
        .filter(
          (op) => op.taskId === taskId || op.results.some((result) => result.taskId === taskId),
        );
      if (
        active.switching ||
        active.attaching ||
        active.operations.size ||
        active.timeline.state.status !== 'idle' ||
        ctx.queuedInputs.get(key(projectId, taskId))?.length ||
        commands.some((command) => ['accepted', 'delivering'].includes(command.state)) ||
        operations.some(
          (op) => op.worker || op.executor || !['applied', 'stale'].includes(op.state),
        )
      )
        throw new Error(
          'Wait for the agent and task integration to finish or stop them before clearing the chat.',
        );
      active.switching = true;
      try {
        await ctx.sessions.detach(active);
        await active.pumping;
        await closeSessionLog(active.log);
        const path = join('runs', projectId, taskId, `${Date.now()}-${randomUUID()}.jsonl`);
        ctx.deps.db.clearRunHistory(
          active.run.id,
          path,
          operations.map((op) => op.id),
        );
        const fresh = new ActiveRun(
          projectId,
          taskId,
          ctx.deps.db.getRun(active.run.id)!,
          new Timeline(),
        );
        fresh.seq = active.seq + 1;
        fresh.mergeSummary = active.mergeSummary;
        fresh.commitMessage = active.commitMessage;
        fresh.verification = active.verification;
        ctx.active.set(key(projectId, taskId), fresh);
        for (const command of commands)
          ctx.deps.emit('command.changed', { ...command, state: 'cancelled', error: undefined });
        await historyReads().reset(`${projectId}:task:${taskId}`, fresh.seq, fresh.timeline.state);
        ctx.changed(projectId, taskId);
      } finally {
        active.switching = false;
      }
    });
  } finally {
    unblock();
  }
}
