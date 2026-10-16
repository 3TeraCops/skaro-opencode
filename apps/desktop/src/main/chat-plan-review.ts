import { randomUUID } from 'node:crypto';
import type { ProjectArtifacts } from '@skaro/core';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { PlanJournal } from './chat-plan-journal';
import { legacyPlanGroups, recoveredReview } from './chat-plan-review-model';
import type { SavedChatPlan } from './chat-planning-store';
import { currentTurn } from './chat-settings-helpers';
import { reconcilePlanIdentity } from './chat-plan-identity';

export class ChatPlanReview {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  tasks(plan: SavedChatPlan, artifacts: ProjectArtifacts) {
    const all = plan.milestones.flatMap((m) => m.tasks);
    const titles = new Map(
      [...artifacts.tasks, ...all].map((t) => ['ref' in t ? t.ref : t.id, t.title]),
    );
    return plan.milestones.flatMap((group) => {
      const milestone = artifacts.milestones.find((m) => m.id === group.milestone);
      return group.tasks.map((task) => ({
        ...this.ctx.plan.proposedTask(task, titles),
        milestone: {
          id: group.milestone,
          title: milestone?.title ?? group.milestone,
          isNew: false,
        },
      }));
    });
  }

  offer(live: LiveChat, plan: SavedChatPlan, artifacts: ProjectArtifacts): void {
    if (
      this.ctx.proposals
        .proposals(live)
        .some((p) => p.proposal.type === 'plan' && p.proposal.planKey === plan.key)
    )
      return;
    const item: ProposalItem = {
      id: `skaro-proposal-${randomUUID()}`,
      turnId: currentTurn(live),
      kind: 'proposal',
      state: 'pending',
      status: 'done',
      startedAt: Date.now(),
      native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
      proposal: {
        type: 'plan',
        complete: true,
        planKey: plan.key,
        title: plan.title,
        tasks: this.tasks(plan, artifacts),
      },
    };
    new PlanJournal(this.ctx, live).save({
      item: reconcilePlanIdentity(item, live.timeline.state.items, artifacts),
    });
  }

  /** Upgrade existing cards before presenting them, preserving files, refusals and journalled writes. */
  async consolidate(live: LiveChat): Promise<void> {
    const journal = new PlanJournal(this.ctx, live);
    journal.restore();
    const groups = legacyPlanGroups(this.ctx.proposals.proposals(live));
    if (!groups.length) return;
    const artifacts = await this.ctx.project(live.projectId).store.load();
    for (const cards of groups) {
      const anchor =
        cards.find((p) => p.state === 'pending' || p.state === 'accepted') ?? cards[0]!;
      if (anchor.proposal.type !== 'plan') continue;
      const saved =
        anchor.proposal.planKey && this.ctx.planning.store(live).get(anchor.proposal.planKey);
      const recovered = recoveredReview(cards, journal.list(), artifacts);
      const tasks = saved ? this.tasks(saved, artifacts) : recovered.tasks;
      // Preserve actual destinations for milestones allocated by older cards.
      for (const task of tasks)
        task.milestone =
          recovered.tasks.find((t) => t.ref === task.ref)?.milestone ?? task.milestone;
      const done = new Set(recovered.created.map((t) => t.ref));
      const remaining = tasks.filter((t) => !done.has(t.ref) && !recovered.omitted.includes(t.ref));
      const accepted =
        remaining.length > 0 && remaining.every((t) => recovered.approved.has(t.ref));
      const item: ProposalItem = {
        ...anchor,
        state: !remaining.length
          ? recovered.created.length
            ? 'applied'
            : 'rejected'
          : accepted
            ? 'accepted'
            : 'pending',
        proposal: {
          type: 'plan',
          complete: true,
          title: saved ? saved.title : undefined,
          ...(anchor.proposal.planKey ? { planKey: anchor.proposal.planKey } : {}),
          tasks,
        },
        result: {
          tasks: recovered.created,
          omitted: recovered.omitted,
          ...(accepted ? { selected: remaining.map((t) => t.ref) } : {}),
        },
      };
      journal.saveAll([
        { item: reconcilePlanIdentity(item, live.timeline.state.items, artifacts) },
        ...cards
          .filter((p) => p.id !== anchor.id)
          .map((p) => ({ item: { ...p, state: 'superseded' as const } })),
      ]);
    }
  }
}
