import type { PayloadStore } from './payload-store';

/** Page invalidation is independent of control delivery and its monotonic revision. */
export class HistoryPageVersions {
  private readonly store: PayloadStore;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_page_revisions (
      owner TEXT PRIMARY KEY,revision INTEGER NOT NULL)`);
  }
  read(owner: string, fallback: number): number {
    const row = this.store.db
      .prepare('SELECT revision FROM feed_page_revisions WHERE owner=?')
      .get(owner);
    return row ? Number(row['revision']) : fallback;
  }
  keep(owner: string, revision: number): void {
    // An existing projection from before this index was added is adopted without a rebuild.
    this.store.db
      .prepare('INSERT OR IGNORE INTO feed_page_revisions VALUES (?,?)')
      .run(owner, revision);
  }
  advance(owner: string, revision: number): void {
    this.store.db
      .prepare(
        `INSERT INTO feed_page_revisions VALUES (?,?) ON CONFLICT(owner)
      DO UPDATE SET revision=excluded.revision`,
      )
      .run(owner, revision);
  }
}
