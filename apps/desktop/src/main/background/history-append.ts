import type { HistoryBlock, HistoryView } from '../../shared/history';
import type { TimelineState } from '@skaro/timeline';
import type { PayloadStore } from './payload-store';
import type { HistorySnapshots } from './history-snapshots';
import type { TextDelta } from './history-text-delta';
import type { HistoryPageVersions } from './history-page-versions';

/** Text/output deltas update indexed rows directly; they never regroup all previous turns. */
export function appendHistory(
  store: PayloadStore,
  snapshots: HistorySnapshots,
  pageVersions: HistoryPageVersions,
  owner: string,
  signature: string,
  events: TextDelta[],
  previous: { revision: number; header: string; snapshot: string },
  advanceOrigin?: () => void,
): HistoryView {
  return store.transaction(() => {
    advanceOrigin?.();
    const items = snapshots.append(owner, events);
    const revision = previous.revision + 1;
    pageVersions.advance(owner, revision);
    const query = store.db.prepare(`SELECT b.key,b.position,b.value,t.role FROM feed_targets t
      JOIN feed_blocks b ON b.owner=t.owner AND b.key=t.key AND b.position=t.position
      WHERE t.owner=? AND t.id=?`);
    const update = store.db.prepare(
      'UPDATE feed_blocks SET value=? WHERE owner=? AND key=? AND position=?',
    );
    for (const [id, item] of items) {
      for (const row of query.all(owner, id)) {
        const block = JSON.parse(String(row['value'])) as HistoryBlock;
        if (row['role'] === 'reply') {
          if (block.presentation && item.kind === 'message') block.presentation.reply = item.text;
        } else if (block.type === 'row' && 'item' in block.row) {
          Object.assign(block.row, { item });
        }
        update.run(JSON.stringify(block), owner, String(row['key']), Number(row['position']));
      }
    }
    const header = JSON.parse(previous.header) as TimelineState;
    header.items = header.items.map((item) => items.get(item.id) ?? item);
    store.db
      .prepare('UPDATE feed_views SET revision=?,signature=?,header=?,snapshot=? WHERE owner=?')
      .run(revision, signature, JSON.stringify(header), previous.snapshot, owner);
    const range = store.db
      .prepare("SELECT count FROM feed_ranges WHERE owner=? AND key='root'")
      .get(owner)!;
    return {
      source: {
        owner,
        key: 'root',
        revision,
        contentRevision: revision,
        count: Number(range['count']),
        itemCount: Number(
          store.db
            .prepare("SELECT count FROM feed_ranges WHERE owner=? AND key='items'")
            .get(owner)?.['count'] ?? 0,
        ),
        changeCount: Number(
          store.db.prepare('SELECT count FROM feed_change_counts WHERE owner=?').get(owner)?.[
            'count'
          ] ?? 0,
        ),
        changeRevision: Number(
          store.db.prepare('SELECT revision FROM feed_change_counts WHERE owner=?').get(owner)?.[
            'revision'
          ] ?? 0,
        ),
      },
      timeline: header,
    };
  });
}
