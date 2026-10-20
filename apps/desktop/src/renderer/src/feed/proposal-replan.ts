import type { Item, TaskReplanProgress, ProposalState } from '@skaro/timeline';
import { t } from '@skaro/ui';
import type { ProposalAction } from '../../../shared/ipc';
import './proposal-replan-i18n';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
export type ReplanOperation = TaskReplanProgress['operation'];

/** The footer and changed panel report the same persisted outcome and real write counts. */
export function replanStatus(item: ProposalItem, requested?: ReplanOperation): string {
  if (item.proposal.type !== 'task_replan') return '';
  return replanProgress(
    item.state,
    item.result?.replan,
    item.proposal.taskIds.length,
    item.result?.tasks?.length ?? item.proposal.tasks.length,
    requested,
  );
}
export function replanProgress(
  state: ProposalState,
  progress: TaskReplanProgress | undefined,
  before: number,
  after: number,
  requested?: ReplanOperation,
): string {
  const operation = requested ?? progress?.operation ?? 'apply';
  const submitting =
    requested && (state === 'pending' || (requested === 'revert' && state === 'applied'));
  if (state === 'accepted' || submitting) {
    const label =
      progress?.error && !requested
        ? t(operation === 'revert' ? 'proposal.replan.revertFailed' : 'proposal.replan.applyFailed')
        : t(operation === 'revert' ? 'proposal.replan.reverting' : 'proposal.replan.applying');
    return progress && (progress.totalWrites > 0 || progress.totalRemoves > 0)
      ? `${label} ${t('proposal.replan.progress', { ...progress })}`
      : label;
  }
  if (state === 'applied' || state === 'reverted')
    return t(`proposal.replan.${state}`, {
      before: before,
      after: after,
    });
  return state === 'pending' ? t('changed.pending') : t(`proposal.hint.${state}`);
}

/** During a durable operation only an explicit retry of its failed direction is available. */
export function replanCanDecide(item: ProposalItem, action: ProposalAction): boolean {
  if (item.proposal.type !== 'task_replan') return true;
  if (item.state === 'pending') return action.action === 'apply' || action.action === 'reject';
  if (item.state === 'applied') return action.action === 'revert';
  const progress = item.result?.replan;
  return (
    item.state === 'accepted' &&
    !!progress?.error &&
    (action.action === progress.operation ||
      (progress.operation === 'apply' && action.action === 'revert'))
  );
}
