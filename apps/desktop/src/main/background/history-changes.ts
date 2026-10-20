import type { TimelineState } from '@skaro/timeline';
import { proposalChanges, type ProposalChange } from '../../shared/proposal-changes';
import type { PayloadStore } from './payload-store';
export class HistoryChanges {
  private readonly store: PayloadStore;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_changes (
      owner TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(owner,position));
      CREATE TABLE IF NOT EXISTS feed_change_counts (owner TEXT PRIMARY KEY,count INTEGER NOT NULL,revision INTEGER NOT NULL)`);
  }
  replace(owner: string, items: TimelineState['items']) {
    const upsert = this.store.db
      .prepare(`INSERT INTO feed_changes VALUES (?,?,?) ON CONFLICT(owner,position)
      DO UPDATE SET value=excluded.value WHERE feed_changes.value<>excluded.value`);
    let count = 0,
      dirty = 0;
    for (const item of items)
      if (item.kind === 'proposal')
        for (const row of proposalChanges(item))
          dirty += Number(upsert.run(owner, count++, JSON.stringify(row)).changes);
    dirty += Number(
      this.store.db
        .prepare('DELETE FROM feed_changes WHERE owner=? AND position>=?')
        .run(owner, count).changes,
    );
    this.store.db
      .prepare(
        `INSERT INTO feed_change_counts VALUES (?,?,1) ON CONFLICT(owner)
      DO UPDATE SET count=excluded.count,revision=revision+?`,
      )
      .run(owner, count, dirty ? 1 : 0);
    return this.info(owner);
  }
  info(owner: string) {
    const row = this.store.db
      .prepare('SELECT count,revision FROM feed_change_counts WHERE owner=?')
      .get(owner);
    return {
      changeCount: Number(row?.['count'] ?? 0),
      changeRevision: Number(row?.['revision'] ?? 0),
    };
  }
  page(owner: string, start: number): ProposalChange[] {
    start = Math.max(0, Math.floor(start));
    return this.store.db
      .prepare(
        'SELECT value FROM feed_changes WHERE owner=? AND position>=? AND position<? ORDER BY position',
      )
      .all(owner, start, start + 16)
      .map((row) => JSON.parse(String(row['value'])) as ProposalChange);
  }
}
