import type { TimelineState, TimelineEvent } from '@skaro/timeline';
import type { PayloadStore } from './payload-store';

/** Turn metadata is indexed too: a streamed token must not rewrite every old turn. */
export class HistoryTurns {
  private readonly store: PayloadStore;
  private readonly changed = new Map<string, Set<string>>();
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_turns (
      owner TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,
      PRIMARY KEY(owner,id)); CREATE INDEX IF NOT EXISTS feed_turn_order ON feed_turns(owner,position)`);
  }
  load(owner: string): TimelineState['turns'] {
    return this.store.db
      .prepare('SELECT value FROM feed_turns WHERE owner=? ORDER BY position')
      .all(owner)
      .map((row) => JSON.parse(String(row['value'])) as TimelineState['turns'][number]);
  }
  observe(owner: string, event: TimelineEvent): void {
    if (event.t !== 'turn.started' && event.t !== 'turn.completed') return;
    let ids = this.changed.get(owner);
    if (!ids) this.changed.set(owner, (ids = new Set()));
    ids.add(event.turnId);
  }
  save(owner: string, turns: TimelineState['turns'], full: boolean): void {
    const changed = this.changed.get(owner);
    this.changed.delete(owner);
    if (!full && !changed?.size) return;
    if (full) this.store.db.prepare('DELETE FROM feed_turns WHERE owner=?').run(owner);
    const upsert = this.store.db.prepare(`INSERT INTO feed_turns VALUES (?,?,?,?)
      ON CONFLICT(owner,id) DO UPDATE SET value=excluded.value,position=excluded.position`);
    // A structural update already rebuilds the affected feed; token appends never enter this path.
    turns.forEach((turn, at) => {
      if (full || changed?.has(turn.id)) upsert.run(owner, turn.id, at, JSON.stringify(turn));
    });
  }
}
