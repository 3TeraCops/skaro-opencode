import type { ProposeMilestonesArgs, ProposeTasksArgs } from './project-tool-model.ts';
import { list, optional, record, tasks, text, uniqueRefs } from './project-tool-args.ts';

export function parseMilestones(args: Record<string, unknown>): ProposeMilestonesArgs {
  const milestones = list(args, 'milestones').map((m, i) => {
    const milestone = record(m, `milestones[${i}]`);
    return {
      title: text(milestone, 'title'),
      goal: text(milestone, 'goal'),
      doneWhen: text(milestone, 'done_when'),
      tasks: tasks(milestone, `m${i + 1}-`, true),
    };
  });
  uniqueRefs(milestones.flatMap((m) => m.tasks));
  return { milestones };
}

export function parseTasks(args: Record<string, unknown>): ProposeTasksArgs {
  const proposed = tasks(args);
  uniqueRefs(proposed);
  return { ...optional(args, 'milestone'), tasks: proposed };
}
