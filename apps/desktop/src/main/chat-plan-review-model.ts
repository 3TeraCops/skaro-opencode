import type { ProjectArtifacts } from '@skaro/core';
import type { ProposedTask, ProposalResult } from '@skaro/timeline';
import type { ProposalItem } from './chat-model';
import type { PlanDecision } from './chat-plan-journal';

/** Only legacy cards from the same saved operation/turn or connected task graph are combined. */
export function legacyPlanGroups(cards: ProposalItem[]): ProposalItem[][] {
  const remaining = cards.filter(
    (p) => p.proposal.type === 'plan' && p.proposal.tasks.length && p.state !== 'superseded',
  );
  const groups: ProposalItem[][] = [];
  while (remaining.length) {
    const group = [remaining.shift()!];
    for (let grew = true; grew;) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const candidate = remaining[i]!;
        if (candidate.proposal.type !== 'plan') continue;
        const proposal = candidate.proposal;
        if (
          group.some((other) => {
            if (other.proposal.type !== 'plan') return false;
            const p = other.proposal;
            if (proposal.planKey || p.planKey) return proposal.planKey === p.planKey;
            if (candidate.turnId && candidate.turnId === other.turnId) return true;
            const refs = new Set(p.tasks.map((t) => t.ref));
            return (
              proposal.tasks.some((t) => t.dependsOn.some((r) => refs.has(r))) ||
              p.tasks.some((t) => t.dependsOn.some((r) => proposal.tasks.some((x) => x.ref === r)))
            );
          })
        ) {
          group.push(...remaining.splice(i, 1));
          grew = true;
        }
      }
    }
    group.sort((a, b) => cards.indexOf(a) - cards.indexOf(b));
    if (
      group.some(
        (p) =>
          p.state === 'pending' ||
          p.state === 'accepted' ||
          (p.proposal.type === 'plan' && !!p.proposal.planKey),
      ) &&
      !group.every((p) => p.proposal.type === 'plan' && p.proposal.complete)
    )
      groups.push(group);
  }
  return groups;
}

export function recoveredReview(
  cards: ProposalItem[],
  records: PlanDecision[],
  artifacts: ProjectArtifacts,
) {
  const tasks: ProposedTask[] = [];
  const created: NonNullable<ProposalResult['tasks']> = [];
  const omitted = new Set<string>();
  const approved = new Set<string>();
  for (const card of cards) {
    if (card.proposal.type !== 'plan') continue;
    const record = records.find((r) => r.item.id === card.id);
    const result = record?.item.result ?? card.result;
    const milestoneId = result?.milestone?.id ?? record?.milestoneId;
    const milestone = milestoneId && artifacts.milestones.find((m) => m.id === milestoneId);
    const target = milestone
      ? { id: milestone.id, title: milestone.title, isNew: false }
      : card.proposal.milestone;
    tasks.push(...card.proposal.tasks.map((t) => ({ ...t, milestone: t.milestone ?? target })));
    created.push(...(result?.tasks ?? []));
    const written = record?.creating && artifacts.tasks.find((t) => t.id === record.creating!.id);
    if (written && !created.some((t) => t.id === written.id))
      created.push({ id: written.id, title: written.title, ref: record!.creating!.ref });
    for (const t of card.proposal.tasks) {
      if (
        card.state === 'rejected' ||
        result?.omitted?.includes(t.ref) ||
        (card.state !== 'pending' && !result?.selected?.includes(t.ref))
      )
        omitted.add(t.ref);
      if (card.state === 'accepted' && result?.selected?.includes(t.ref)) approved.add(t.ref);
    }
  }
  for (const t of created) omitted.delete(t.ref);
  return { tasks, created, omitted: [...omitted], approved };
}
