import type { ProposalChange } from '../../../shared/proposal-changes';
import { t, tn } from '@skaro/ui';
import './plan-decisions-i18n';
import { replanProgress } from '../feed/proposal-replan';
import '../c4/i18n';
export type ProposalItem = ProposalChange;
/** "Изменено в чате": what each proposal is and where it stands. */
export function changed(item: ProposalItem): {
  icon: 'file' | 'adr' | 'spec' | 'milestone' | 'import';
  title: string;
  note: string;
  pending: boolean;
} {
  if (item.imported) return importedRow(item.imported);
  const p = item.proposal;
  const pending = item.state === 'pending';
  const settled =
    item.state === 'rejected'
      ? t('changed.rejected')
      : item.state === 'reverted'
        ? t('changed.reverted')
        : undefined;
  switch (p.type) {
    case 'architecture':
      return {
        icon: 'file',
        title: p.title,
        pending: pending || item.state === 'accepted',
        note:
          item.result?.error ??
          (pending
            ? t('changed.pending')
            : (settled ?? t(item.state === 'accepted' ? 'c4.applying' : 'c4.applied'))),
      };
    case 'doc':
      return {
        icon: 'file',
        title: p.path,
        pending,
        note: pending
          ? t('changed.pending')
          : (settled ?? (p.created ? t('changed.doc.created') : t('changed.doc.updated'))),
      };
    case 'task':
      return {
        icon: 'file',
        title: `${p.id} · ${p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.task.updated')),
      };
    case 'task_replan':
      return {
        icon: 'file',
        title: p.title,
        pending,
        note: replanProgress(
          item.state,
          item.result?.replan,
          p.beforeCount,
          item.result?.taskCount ?? p.afterCount,
        ),
      };
    case 'adr':
      return {
        icon: 'adr',
        title: `ADR-${item.result?.adr?.id ?? p.id} · ${item.result?.adr?.title ?? p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.adr.accepted')),
      };
    case 'import':
      return {
        icon: 'import',
        title: t('changed.import'),
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.pending')),
      };
    case 'spec':
      return {
        icon: 'spec',
        title: `SPEC-${item.result?.spec?.id ?? p.id} · ${item.result?.spec?.title ?? p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.spec.accepted')),
      };
    case 'spec_change':
      return {
        icon: 'spec',
        title: `SPEC-${p.id} · ${p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.spec.updated')),
      };
    case 'plan':
      return {
        icon: 'milestone',
        title: p.complete
          ? t('proposal.plan.complete', {
              title: p.title ?? t('proposal.plan.defaultTitle'),
              tasks: tn('proposal.tasks', p.taskCount),
            })
          : p.milestone?.isNew
            ? `${item.result?.milestone?.id ?? p.milestone.id} · ${p.milestone.title}`
            : `${p.milestone ? `${p.milestone.id} · ` : ''}${tn('proposal.tasks', p.taskCount)}`,
        pending,
        note:
          item.state === 'accepted'
            ? (item.result?.error ?? t('proposal.plan.creating'))
            : item.state === 'rejected' && (item.result?.taskCount || item.result?.milestone)
              ? t(
                  item.result.milestone
                    ? 'proposal.plan.cancelledMilestone'
                    : 'proposal.plan.cancelled',
                  { done: item.result.taskCount ?? 0, id: item.result.milestone?.id ?? '' },
                )
              : pending
                ? t('changed.pending')
                : (settled ??
                  (p.milestone?.isNew ? t('changed.plan.milestone') : t('changed.plan.tasks'))),
      };
  }
}

/** Rows of "Изменено в чате": one per proposal, what an applied import wrote one by one. */
export function changedRows(proposals: ProposalChange[]) {
  return proposals.map((item) => ({
    key: item.id,
    item,
    c: item.imported ? importedRow(item.imported) : changed(item),
  }));
}

function importedRow(x: {
  kind: string;
  code?: string;
  title: string;
  update: boolean;
}): ReturnType<typeof changed> {
  const titled = x.code ? `${x.code} · ${x.title}` : x.title;
  switch (x.kind) {
    case 'adr':
      return {
        icon: 'adr',
        title: titled,
        pending: false,
        note: x.update ? t('changed.doc.updated') : t('changed.adr.accepted'),
      };
    case 'spec':
      return {
        icon: 'spec',
        title: titled,
        pending: false,
        note: x.update ? t('changed.spec.updated') : t('changed.spec.accepted'),
      };
    case 'plan':
      return {
        icon: 'milestone',
        title: titled,
        pending: false,
        note: t('changed.plan.milestone'),
      };
    default:
      return {
        icon: 'file',
        title:
          x.kind === 'brief' ? 'brief.md' : x.kind === 'architecture' ? 'architecture.md' : x.title,
        pending: false,
        note: x.update ? t('changed.doc.updated') : t('changed.doc.createdShort'),
      };
  }
}
