import type { LiveChat } from './chat-model';
import type { ChatPlanning } from './chat-planning';

/** Legacy single-task proposals remain valid; batches must enter the persisted workflow. */
export function planningProposalProblem(
  live: LiveChat,
  planning: ChatPlanning,
  taskCount: number,
): string | undefined {
  if (!taskCount) return undefined;
  if (planning.store(live).current()) {
    return 'Use propose_saved_plan for the saved operation; do not bypass or duplicate its tasks.';
  }
  if (taskCount > 1) {
    return 'Multiple implementation tasks require a COMPLETE saved plan. Use prepare_plan, then propose_saved_plan and finish_plan. For new milestones, propose tasks: [] and obtain acceptance first.';
  }
  return undefined;
}
