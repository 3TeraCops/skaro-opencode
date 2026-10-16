import type { ProjectArtifacts } from '@skaro/core';
import type { Item, ProposedTask } from '@skaro/timeline';

/** Validate before the first write; an uncreated dependency is never silently discarded. */
export function checkedPlanDependencies(
  chosen: ProposedTask[],
  items: Item[],
  artifacts: ProjectArtifacts,
): Map<string, string> {
  const existing = new Set(artifacts.tasks.map((t) => t.id));
  const known = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'proposal') continue;
    for (const task of item.result?.tasks ?? []) {
      if (existing.has(task.id)) known.set(task.ref, task.id);
    }
  }
  const selected = new Set(chosen.map((t) => t.ref));
  if (selected.size !== chosen.length) throw new Error('Duplicate task refs.');
  const missing: string[] = [];
  for (const task of chosen) {
    for (const [i, dependency] of task.dependsOn.entries()) {
      if (dependency === task.ref) throw new Error(`Task "${task.title}" cannot depend on itself.`);
      if (selected.has(dependency) || known.has(dependency) || existing.has(dependency)) continue;
      missing.push(`"${task.title}" → "${task.dependsOnTitles[i] ?? dependency}"`);
    }
  }
  if (missing.length) {
    throw new Error(
      'Tasks were not created because dependencies are not created or selected: ' +
        missing.join(', ') +
        '. The selected plan must include its prerequisites. Revise the complete plan before confirmation.',
    );
  }
  const deps = new Map(chosen.map((t) => [t.ref, t.dependsOn]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (ref: string) => {
    if (visiting.has(ref)) throw new Error('Selected task dependencies form a cycle.');
    if (visited.has(ref)) return;
    visiting.add(ref);
    for (const dependency of deps.get(ref) ?? []) if (selected.has(dependency)) visit(dependency);
    visiting.delete(ref);
    visited.add(ref);
  };
  for (const ref of selected) visit(ref);
  for (const id of existing) if (!known.has(id)) known.set(id, id);
  return known;
}
