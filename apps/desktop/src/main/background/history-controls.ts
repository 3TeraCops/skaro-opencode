import type { TimelineEvent, TimelineState } from '@skaro/timeline';
import type { HistorySource, HistoryView } from '../../shared/history';
import type { PayloadStore } from './payload-store';
import type { HistorySnapshots } from './history-snapshots';
import type { HistoryPageVersions } from './history-page-versions';

export type HistoryControl = Extract<
  TimelineEvent,
  {
    t: 'session.started' | 'plan.updated' | 'usage' | 'limits' | 'activity' | 'status';
  }
>;

/** These events affect controls only: feed rows depend on items, turns and interactions. */
export function isHistoryControl(event: TimelineEvent): event is HistoryControl {
  return ['session.started', 'plan.updated', 'usage', 'limits', 'activity', 'status'].includes(
    event.t,
  );
}

export function updateHistoryControls(input: {
  store: PayloadStore;
  snapshots: HistorySnapshots;
  pageVersions: HistoryPageVersions;
  owner: string;
  signature: string;
  events: HistoryControl[];
  previous: { revision: number; header: string; snapshot: string };
  source(revision: number): HistorySource;
  combine?: (state: TimelineState) => void;
}): HistoryView {
  const { store, snapshots, owner, signature, events, previous } = input;
  return store.transaction(() => {
    input.pageVersions.keep(owner, previous.revision);
    const next = snapshots.controls(owner, previous.snapshot, events, input.combine);
    const header = { ...(JSON.parse(previous.header) as TimelineState), ...next.header };
    const revision = previous.revision + 1;
    store.db
      .prepare('UPDATE feed_views SET revision=?,signature=?,header=?,snapshot=? WHERE owner=?')
      .run(revision, signature, JSON.stringify(header), next.metadata, owner);
    return { source: input.source(revision), timeline: header };
  });
}
