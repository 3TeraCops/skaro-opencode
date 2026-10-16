import type { ProjectArtifacts } from '@skaro/core';
import type { Item } from '@skaro/timeline';

export function createdPlanRefs(items: Item[], artifacts: ProjectArtifacts) {
  const known = new Map(artifacts.tasks.map((t) => [t.id, t.id]));
  for (const item of items) {
    if (item.kind !== 'proposal') continue;
    for (const task of item.result?.tasks ?? []) {
      if (known.has(task.id)) known.set(task.ref, task.id);
    }
  }
  return known;
}
