import type { ProjectArtifacts } from '@skaro/core';
import type { SavedPlanTask } from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import { adrId } from './chat-proposal-helpers';

export function planningReadiness(
  tasks: SavedPlanTask[],
  artifacts: ProjectArtifacts,
  items: Item[],
) {
  const ready: SavedPlanTask[] = [];
  const waiting: string[] = [];
  const blockers: string[] = [];
  for (const task of tasks) {
    if (!task.spec) {
      ready.push(task);
      continue;
    }
    const id = adrId(task.spec);
    const spec = artifacts.specs.find((s) => s.id === id);
    if (spec?.status === 'accepted') {
      ready.push(task);
      continue;
    }
    const pending = items.some(
      (item) =>
        item.kind === 'proposal' &&
        item.state === 'pending' &&
        item.proposal.type === 'spec' &&
        adrId(item.proposal.id) === id,
    );
    if (pending || spec?.status === 'proposed') waiting.push(`SPEC-${id}`);
    else blockers.push(`${task.ref}: SPEC-${id} is missing, rejected or superseded.`);
  }
  return { ready, waiting: [...new Set(waiting)], blockers };
}
