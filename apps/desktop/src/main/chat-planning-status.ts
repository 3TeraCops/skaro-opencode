import type { ProjectArtifacts } from '@skaro/core';
import type { Item } from '@skaro/timeline';
import type { SavedChatPlan } from './chat-planning-store';

export function savedPlanStatus(plan: SavedChatPlan, items: Item[], artifacts: ProjectArtifacts) {
  const existing = new Map(artifacts.tasks.map((t) => [t.id, t]));
  const rows = plan.milestones.flatMap((group) =>
    group.tasks.map((task) => {
      const card = items.find(
        (item) =>
          item.kind === 'proposal' &&
          item.state !== 'superseded' &&
          item.proposal.type === 'plan' &&
          item.proposal.planKey === plan.key &&
          item.proposal.tasks.some((t) => t.ref === task.ref),
      );
      if (!card || card.kind !== 'proposal')
        return { ...task, milestone: group.milestone, state: 'prepared' as const };
      const result = card.result?.tasks?.find((t) => t.ref === task.ref);
      const created = result && existing.get(result.id);
      const state = result
        ? created
          ? 'created'
          : 'missing'
        : card.result?.omitted?.includes(task.ref)
          ? 'declined'
          : card.state === 'accepted' && card.result?.selected?.includes(task.ref)
            ? 'creating'
            : card.state === 'pending'
              ? 'pending'
              : card.state === 'rejected'
                ? 'rejected'
                : 'declined';
      return { ...task, milestone: group.milestone, state, ...(result ? { id: result.id } : {}) };
    }),
  );
  const remaining = rows.filter((t) => t.state === 'prepared');
  const counts = {
    prepared: rows.length,
    proposed: rows.length - remaining.length,
    created: rows.filter((t) => t.state === 'created').length,
    pending: rows.filter((t) => t.state === 'pending').length,
    creating: rows.filter((t) => t.state === 'creating').length,
    rejected: rows.filter((t) => t.state === 'rejected' || t.state === 'declined').length,
    missing: rows.filter((t) => t.state === 'missing').length,
    unproposed: remaining.length,
  };
  return {
    key: plan.key,
    title: plan.title,
    state: plan.state,
    reason: plan.reason,
    counts,
    tasks: rows,
  };
}

export function planStatusText(
  plan: SavedChatPlan,
  items: Item[],
  artifacts: ProjectArtifacts,
): string {
  return JSON.stringify(savedPlanStatus(plan, items, artifacts), null, 2);
}
