import { containerTask, type DockerContainer, type TaskKey } from '@skaro/core';
import type { EnvironmentRecord } from './task-environment-registry';

const id = (key: TaskKey) => `${key.projectId}\n${key.taskId}`;

/**
 * Only an active queue lease or a start request keeps services running. Idle environments
 * are stopped even when the queue has spare capacity; their data is kept. Returns
 * the idle tasks that are finished: their environments are to be removed, running or not.
 */
export async function reconcileTaskEnvironments(options: {
  containers: DockerContainer[];
  worktrees: string;
  names: ReadonlyMap<string, TaskKey>;
  records: EnvironmentRecord[];
  busy: TaskKey[];
  /** The task whose environment is about to start: it takes a place even with nothing running. */
  starting?: TaskKey;
  finished: (key: TaskKey) => Promise<boolean>;
  stop: (containers: DockerContainer[]) => Promise<void>;
}): Promise<TaskKey[]> {
  const busy = new Set(options.busy.map(id));
  if (options.starting) busy.add(id(options.starting));
  const groups = new Map<string, { key: TaskKey; containers: DockerContainer[] }>();
  for (const container of options.containers) {
    const key = containerTask(container, options.worktrees, options.names);
    if (!key) continue;
    const group = groups.get(id(key)) ?? { key, containers: [] };
    group.containers.push(container);
    groups.set(id(key), group);
  }
  for (const record of options.records) {
    if (!groups.has(id(record))) groups.set(id(record), { key: record, containers: [] });
  }

  const stale: TaskKey[] = [];
  for (const [taskId, group] of groups) {
    if (busy.has(taskId) || !(await options.finished(group.key))) continue;
    stale.push(group.key);
    groups.delete(taskId);
  }

  const running = [...groups.values()].filter((g) => g.containers.some((c) => c.State?.Running));
  for (const group of running.filter((g) => !busy.has(id(g.key)))) {
    await options.stop(group.containers);
  }
  return stale;
}
