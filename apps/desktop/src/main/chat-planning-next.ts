import type { ProjectArtifacts } from '@skaro/core';
import type { Item } from '@skaro/timeline';
import type { SavedChatPlan } from './chat-planning-store';
import { preparedPlanProblem } from './chat-planning-store';
import { savedPlanStatus } from './chat-planning-status';
import { planningReadiness } from './chat-planning-readiness';

export function planningNextStep(
  plan: SavedChatPlan,
  items: Item[],
  artifacts: ProjectArtifacts,
  continuations: number,
) {
  const status = savedPlanStatus(plan, items, artifacts);
  const remaining = status.tasks.filter((t) => t.state === 'prepared');
  const readiness = planningReadiness(remaining, artifacts, items);
  const problem = preparedPlanProblem(plan, artifacts);
  const attempts = status.counts.proposed > plan.lastProgress ? 0 : plan.attempts;
  if (problem || status.counts.missing || readiness.blockers.length) {
    return {
      action: 'blocked' as const,
      status,
      attempts,
      reason: problem || readiness.blockers.join('\n') || 'A previously created task is missing.',
    };
  }
  if (remaining.length && readiness.waiting.length) {
    return {
      action: 'waiting' as const,
      status,
      attempts,
      reason: `Waiting for acceptance: ${readiness.waiting.join(', ')}.`,
    };
  }
  if (attempts >= 2 || continuations >= 12) {
    return {
      action: 'blocked' as const,
      status,
      attempts,
      reason: 'Agent did not finish the saved plan within the continuation limit.',
    };
  }
  return { action: 'continue' as const, status, attempts, reason: undefined };
}
