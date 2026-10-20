import { Timeline, type TimelineState, type TimelineEvent } from '@skaro/timeline';
import type { PayloadStore } from './payload-store';
import { HistoryTurns } from './history-turns';
import { applyTextDeltas, type TextDelta } from './history-text-delta';
import type { HistoryControl } from './history-controls';

/** Persistent canonical items are individual records, never one rewritten conversation blob. */
export class HistorySnapshots {
  private readonly store: PayloadStore;
  private readonly cache = new Map<string, Timeline>();
  private readonly turns: HistoryTurns;
  private readonly budget: number;
  constructor(store: PayloadStore, budget = 32 * 1024 * 1024) {
    this.budget = budget;
    this.store = store;
    this.turns = new HistoryTurns(store);
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_items (
      owner TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(owner,id));
      CREATE INDEX IF NOT EXISTS feed_item_order ON feed_items(owner,position)`);
  }
  load(owner: string, metadata: string): Timeline {
    const cached = this.cache.get(owner);
    if (cached) {
      this.remember(owner, cached);
      return cached;
    }
    const { turnsIndexed, ...state } = JSON.parse(metadata) as TimelineState & {
      turnsIndexed?: boolean;
    };
    if (turnsIndexed) state.turns = this.turns.load(owner);
    state.items = this.store.db
      .prepare('SELECT value FROM feed_items WHERE owner=? ORDER BY position')
      .all(owner)
      .map((row) => JSON.parse(String(row['value'])) as TimelineState['items'][number]);
    const timeline = Timeline.restore(state);
    this.remember(owner, timeline);
    return timeline;
  }
  private remember(owner: string, timeline: Timeline): void {
    this.cache.delete(owner);
    this.cache.set(owner, timeline);
  }
  clear(): void {
    this.cache.clear();
  }
  get retainedBytes(): number {
    let bytes = 0;
    for (const timeline of this.cache.values()) bytes += timeline.retainedBytes;
    return bytes;
  }
  /** Call after the synchronous read/write operation releases its working snapshot. */
  trim(): void {
    let bytes = this.retainedBytes;
    for (const [owner, timeline] of this.cache) {
      if (bytes <= this.budget && this.cache.size <= 3) break;
      this.cache.delete(owner);
      bytes -= timeline.retainedBytes;
    }
  }
  save(owner: string, state: TimelineState, changed?: Set<string>): string {
    const upsert = this.store.db.prepare(`INSERT INTO feed_items VALUES (?,?,?,?)
      ON CONFLICT(owner,id) DO UPDATE SET value=excluded.value`);
    if (!changed) this.store.db.prepare('DELETE FROM feed_items WHERE owner=?').run(owner);
    if (changed) {
      const timeline = this.cache.get(owner)!;
      for (const id of changed) {
        const item = timeline.item(id),
          at = timeline.position(id);
        if (item && at !== undefined) upsert.run(owner, id, at, JSON.stringify(item));
      }
    } else
      state.items.forEach((item, index) => upsert.run(owner, item.id, index, JSON.stringify(item)));
    if (!changed && this.cache.get(owner)?.state !== state)
      this.remember(owner, Timeline.restore(state));
    this.turns.save(owner, state.turns, !changed);
    return JSON.stringify({ ...state, items: [], turns: [], turnsIndexed: true });
  }
  append(owner: string, events: TextDelta[]) {
    const resident = this.cache.get(owner);
    if (resident) this.remember(owner, resident);
    return applyTextDeltas(this.store, owner, events, resident);
  }
  /** Updating controls must not hydrate an evicted archive or rebuild resident item indexes. */
  controls(
    owner: string,
    metadata: string,
    events: HistoryControl[],
    combine?: (state: TimelineState) => void,
  ) {
    const saved = JSON.parse(metadata) as TimelineState & { turnsIndexed?: boolean };
    const { items: _items, turns: _turns, turnsIndexed: _indexed, ...previous } = saved;
    const timeline = Timeline.restore({ ...previous, items: [], turns: [] });
    for (const event of events) timeline.apply(event);
    combine?.(timeline.state);
    const { items: _appliedItems, turns: _appliedTurns, ...header } = timeline.state;
    const resident = this.cache.get(owner);
    if (resident) {
      Object.assign(resident.state, header);
      this.remember(owner, resident);
    }
    return { header, metadata: JSON.stringify({ ...saved, ...header }) };
  }
  apply(owner: string, metadata: string, events: TimelineEvent[]) {
    const timeline = this.load(owner, metadata);
    const changed = new Set<string>();
    for (const event of events) {
      this.turns.observe(owner, event);
      if (event.t === 'item.upsert') changed.add(event.item.id);
      else if (event.t === 'item.append') changed.add(event.itemId);
      else if (event.t === 'turn.completed')
        for (const item of timeline.liveItems(event.turnId)) changed.add(item.id);
      timeline.apply(event);
    }
    return { state: timeline.state, changed };
  }
}
