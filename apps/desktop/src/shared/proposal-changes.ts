import type { Item, Proposal, ProposalResult, ProposalState } from '@skaro/timeline';
type Of<K extends Proposal['type']> = Extract<Proposal, { type: K }>;
/** Presentation facts only: panel rows never require proposal bodies, diffs or task graphs. */
export type ChangeProposal =
  | Pick<Of<'architecture'>, 'type' | 'title'>
  | { type: 'doc'; path: string; created: boolean }
  | Pick<Of<'task'>, 'type' | 'id' | 'title'>
  | { type: 'task_replan'; title: string; beforeCount: number; afterCount: number }
  | Pick<Of<'adr' | 'spec' | 'spec_change'>, 'type' | 'id' | 'title'>
  | {
      type: 'plan';
      title?: string;
      complete?: boolean;
      milestone?: Of<'plan'>['milestone'];
      taskCount: number;
    }
  | { type: 'import' };
export interface ProposalChange {
  id: string;
  itemId: string;
  state: ProposalState;
  proposal: ChangeProposal;
  result?: Pick<ProposalResult, 'error' | 'adr' | 'spec' | 'milestone' | 'replan'> & {
    taskCount?: number;
  };
  imported?: NonNullable<ProposalResult['imported']>[number];
}
export function proposalChanges(item: Extract<Item, { kind: 'proposal' }>): ProposalChange[] {
  if (item.state === 'superseded') return [];
  const p = item.proposal;
  let proposal: ChangeProposal;
  switch (p.type) {
    case 'architecture':
      proposal = { type: p.type, title: p.title };
      break;
    case 'doc':
      proposal = { type: p.type, path: p.path, created: p.before === undefined };
      break;
    case 'task':
    case 'adr':
    case 'spec':
    case 'spec_change':
      proposal = { type: p.type, id: p.id, title: p.title };
      break;
    case 'task_replan':
      proposal = {
        type: p.type,
        title: p.title,
        beforeCount: p.taskIds.length,
        afterCount: p.tasks.length,
      };
      break;
    case 'plan':
      proposal = {
        type: p.type,
        title: p.title,
        complete: p.complete,
        taskCount: p.tasks.length,
        ...(p.milestone
          ? {
              milestone: { id: p.milestone.id, title: p.milestone.title, isNew: p.milestone.isNew },
            }
          : {}),
      };
      break;
    case 'import':
      proposal = { type: p.type };
      break;
  }
  const result = item.result && {
    error: item.result.error,
    adr: item.result.adr,
    spec: item.result.spec,
    milestone: item.result.milestone,
    replan: item.result.replan,
    ...(item.result.tasks ? { taskCount: item.result.tasks.length } : {}),
  };
  const row = {
    id: item.id,
    itemId: item.id,
    state: item.state,
    proposal,
    ...(result ? { result } : {}),
  };
  if (p.type === 'import' && item.state === 'applied')
    return (item.result?.imported ?? [])
      .filter((value) => value.kind !== 'plan' || value.code?.startsWith('M'))
      .map((imported, index) => ({ ...row, id: `${item.id}-${index}`, imported }));
  return [row];
}
