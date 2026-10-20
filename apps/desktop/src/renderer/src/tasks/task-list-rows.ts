import type { TaskSummary } from '../../../shared/ipc';
import type { Group } from './model';
export type TaskListEntry = { id: string } & (
  | { kind: 'header'; group: Omit<Group, 'tasks'> }
  | { kind: 'task'; task: TaskSummary; first: boolean; last: boolean }
);
export function taskListRows(groups: Group[]): TaskListEntry[] {
  return groups.flatMap((group) => [
    {
      id: `group:${group.id}`,
      kind: 'header' as const,
      group: { id: group.id, title: group.title, total: group.total, done: group.done },
    },
    ...group.tasks.map((task, index) => ({
      id: task.id,
      kind: 'task' as const,
      task,
      first: index === 0,
      last: index === group.tasks.length - 1,
    })),
  ]);
}
