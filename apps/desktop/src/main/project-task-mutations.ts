import type { AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';

const queues = new WeakMap<ProjectContext, Promise<void>>();
export const taskReplanLockKey = (projectId: string) => `task.replan-lock.${projectId}`;

/** Task graph writes and new task launches share this short-lived gate. */
export function serializeTaskMutation<T>(
  context: ProjectContext,
  action: () => Promise<T>,
  recovery = false,
): Promise<T> {
  const next = (queues.get(context) ?? Promise.resolve()).then(() => {
    if (!recovery) context.assertTasksMutable();
    return action();
  });
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(context, settled);
  void settled.then(() => {
    if (queues.get(context) === settled) queues.delete(context);
  });
  return next;
}

export function assertTaskGraphAvailable(db: AppDb, projectId: string): void {
  if (db.getSetting<string | null>(taskReplanLockKey(projectId), null)) {
    throw new Error(
      'Task replanning is being applied or recovering. Open its project chat to finish it before changing or starting tasks.',
    );
  }
}
