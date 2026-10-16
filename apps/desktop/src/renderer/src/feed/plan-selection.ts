import type { ProposedTask } from '@skaro/timeline';

/** Keep the selection closed over prerequisites; removing a prerequisite removes dependents. */
export function togglePlanTask(
  tasks: ProposedTask[],
  selected: Set<string>,
  ref: string,
  created: Set<string>,
) {
  const next = new Set(selected);
  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  if (created.has(ref)) return next;
  if (next.has(ref)) {
    const remove = (key: string) => {
      if (!next.delete(key)) return;
      for (const task of tasks)
        if (task.dependsOn.includes(key) && !created.has(task.ref)) remove(task.ref);
    };
    remove(ref);
  } else {
    const include = (key: string) => {
      if (next.has(key) || created.has(key) || !byRef.has(key)) return;
      next.add(key);
      for (const dependency of byRef.get(key)!.dependsOn) include(dependency);
    };
    include(ref);
  }
  return next;
}
