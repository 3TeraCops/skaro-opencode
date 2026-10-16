import type { ProjectArtifacts, Task } from '@skaro/core';
import { findCycle } from './chat-proposal-helpers';
import type { ChatEngine } from './chat-engine';
import type { TaskReplanDecision } from './task-replan-journal';
import { assertReplanArtifacts, assertTasksUnstarted } from './task-replan-guard';

export function replanOriginals(decision: TaskReplanDecision): Task[] {
  const ids = new Set([...decision.writes.map((w) => w.id), ...decision.removes.map((t) => t.id)]);
  return decision.before.filter((t) => ids.has(t.id));
}

/** Check the graph that would exist after restoration, including newly added incoming edges. */
export async function assertRevertSafe(
  ctx: ChatEngine,
  decision: TaskReplanDecision,
  artifacts: ProjectArtifacts,
): Promise<void> {
  assertReplanArtifacts(artifacts);
  const originals = replanOriginals(decision);
  const touched = new Set([...decision.writes.map((w) => w.id), ...originals.map((t) => t.id)]);
  const context = ctx.project(decision.projectId);
  await assertTasksUnstarted(
    ctx.deps.db,
    ctx.deps.dataDir,
    context,
    artifacts,
    artifacts.tasks.filter((t) => touched.has(t.id)).map((t) => t.id),
  );
  // Removed originals and renamed results may still have old launch history or branch names.
  await assertTasksUnstarted(
    ctx.deps.db,
    ctx.deps.dataDir,
    context,
    { ...artifacts, tasks: originals },
    originals.map((t) => t.id),
  );
  for (const task of artifacts.tasks.filter((t) => !touched.has(t.id))) {
    const before = decision.before.find((t) => t.id === task.id);
    if (task.dependsOn.some((id) => touched.has(id) && !before?.dependsOn.includes(id)))
      throw new Error(`${task.id}: a new dependency on replanned work prevents reverting.`);
  }
  const restored = [...artifacts.tasks.filter((t) => !touched.has(t.id)), ...originals];
  const ids = new Set(restored.map((t) => t.id));
  for (const task of restored) {
    if (task.dependsOn.some((id) => !ids.has(id)))
      throw new Error(`${task.id}: reverting would leave an unknown task dependency.`);
    if (
      originals.includes(task) &&
      ((task.milestone && !artifacts.milestones.some((m) => m.id === task.milestone)) ||
        (task.spec && !artifacts.specs.some((s) => s.id === task.spec)))
    )
      throw new Error(`${task.id}: its original milestone or specification no longer exists.`);
  }
  if (findCycle(restored.map((t) => ({ ref: t.id, dependsOn: t.dependsOn }))))
    throw new Error('Reverting would create a dependency cycle.');
}
