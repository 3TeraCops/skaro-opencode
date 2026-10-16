import type { ChatEngine } from './chat-engine';
import { serializeTaskMutation } from './project-task-mutations';

const queues = new WeakMap<ChatEngine, Map<string, Promise<void>>>();

/** Chats in one project must recheck existing tasks after the previous writer finishes. */
export function serializePlanCreation<T>(
  engine: ChatEngine,
  projectId: string,
  action: () => Promise<T>,
): Promise<T> {
  let projects = queues.get(engine);
  if (!projects) queues.set(engine, (projects = new Map()));
  const next = (projects.get(projectId) ?? Promise.resolve()).then(() =>
    serializeTaskMutation(engine.project(projectId), action),
  );
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  projects.set(projectId, settled);
  void settled.then(() => {
    if (projects.get(projectId) === settled) projects.delete(projectId);
  });
  return next;
}
