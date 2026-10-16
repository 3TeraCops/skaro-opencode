import type { ChatEngine } from './chat-engine';
import type { ProjectArtifacts } from '@skaro/core';
import { unstartedTaskProblem } from './task-replan-guard';
import { TaskReplanJournal } from './task-replan-journal';

export function taskReplanContext(
  ctx: ChatEngine,
  projectId: string,
  artifacts: ProjectArtifacts,
): string {
  return (
    '\n\n## Existing task replanning\n' +
    'Candidates below still require Git branch verification by replan_tasks. Read the source task files before proposing replacements.\n' +
    JSON.stringify(
      artifacts.tasks.map((task) => {
        const reason = unstartedTaskProblem(ctx.deps.db, ctx.deps.dataDir, projectId, task);
        return { id: task.id, candidate: !reason, ...(reason ? { reason } : {}) };
      }),
    ) +
    '\nDurable replan operations:\n' +
    JSON.stringify(
      new TaskReplanJournal(ctx.deps.db, projectId).list().map((d) => ({
        proposal: d.item.id,
        chatId: d.chatId,
        state: d.phase,
        replacements: d.ids,
        error: d.error,
      })),
    )
  );
}
