import { Timeline, type TimelineState, type TimelineEvent } from '@skaro/timeline';
import type { HistoryOrigin } from '../../shared/history';
import type { PayloadStore } from './payload-store';

/** Completion of one native stream cannot expire another stream's questions or permissions. */
export class HistoryOrigins {
  private readonly store: PayloadStore;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_origins (
      owner TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,seq INTEGER NOT NULL,
      live INTEGER NOT NULL,header TEXT NOT NULL,PRIMARY KEY(owner,id))`);
  }
  replace(owner: string, origins: HistoryOrigin[], force: boolean): void {
    this.store.transaction(() => {
      if (force) this.store.db.prepare('DELETE FROM feed_origins WHERE owner=?').run(owner);
      const upsert = this.store.db.prepare(`INSERT INTO feed_origins VALUES (?,?,?,?,?,?)
        ON CONFLICT(owner,id) DO UPDATE SET position=excluded.position,live=excluded.live,
        header=CASE WHEN excluded.seq>=feed_origins.seq THEN excluded.header ELSE feed_origins.header END,
        seq=MAX(feed_origins.seq,excluded.seq)`);
      origins.forEach((origin, index) =>
        upsert.run(
          owner,
          origin.id,
          index,
          origin.seq,
          Number(origin.live),
          JSON.stringify(origin.timeline),
        ),
      );
      const wanted = new Set(origins.map((origin) => origin.id));
      for (const row of this.store.db
        .prepare('SELECT id FROM feed_origins WHERE owner=?')
        .all(owner))
        if (!wanted.has(String(row['id'])))
          this.store.db
            .prepare('DELETE FROM feed_origins WHERE owner=? AND id=?')
            .run(owner, String(row['id']));
    });
  }
  /** Text deltas change no controls, but the origin sequence still advances atomically. */
  advance(owner: string, id: string, seq: number): void {
    const result = this.store.db
      .prepare('UPDATE feed_origins SET seq=? WHERE owner=? AND id=?')
      .run(seq, owner, id);
    if (!result.changes) throw new Error('Unknown history stream');
  }
  apply(
    owner: string,
    id: string,
    seq: number,
    events: TimelineEvent[],
    state: TimelineState,
  ): void {
    const row = this.store.db
      .prepare('SELECT header FROM feed_origins WHERE owner=? AND id=?')
      .get(owner, id);
    if (!row) throw new Error('Unknown history stream');
    const timeline = Timeline.restore(JSON.parse(String(row['header'])) as TimelineState);
    for (const event of events)
      if (event.t !== 'item.upsert' && event.t !== 'item.append') timeline.apply(event);
    this.store.db
      .prepare('UPDATE feed_origins SET seq=?,header=? WHERE owner=? AND id=?')
      .run(seq, JSON.stringify(timeline.state), owner, id);
    this.combine(owner, state);
  }
  prepare(
    owner: string,
    state: TimelineState,
    origins: HistoryOrigin[],
    force: boolean,
    previous: () => TimelineState | undefined,
  ): TimelineState {
    const saved = this.store.db.prepare('SELECT id,seq FROM feed_origins WHERE owner=?').all(owner);
    const stale = new Set(
      force
        ? []
        : origins
            .filter((origin) =>
              saved.some((row) => row['id'] === origin.id && Number(row['seq']) > origin.seq),
            )
            .map((origin) => origin.id),
    );
    const old = stale.size ? previous() : undefined;
    if (old) {
      const prefixes = [
        ...new Set([
          ...saved.map((row) => String(row['id'])),
          ...origins.map((origin) => origin.id),
        ]),
      ]
        .filter((id) => id !== 'base')
        .map((id) => `${id}:`);
      const belongs = (value: string, id: string) =>
        id === 'base'
          ? !prefixes.some((prefix) => value.startsWith(prefix))
          : value.startsWith(`${id}:`);
      state = {
        ...state,
        items: origins
          .flatMap((origin) =>
            (stale.has(origin.id) ? old : state).items.filter((item) =>
              belongs(item.id, origin.id),
            ),
          )
          .sort((a, b) => a.startedAt - b.startedAt),
        turns: origins.flatMap((origin) =>
          (stale.has(origin.id) ? old : state).turns.filter((turn) => belongs(turn.id, origin.id)),
        ),
      };
    }
    this.replace(owner, origins, force);
    this.combine(owner, state);
    return state;
  }
  rewind(
    owner: string,
    id: string,
    seq: number,
    events: TimelineEvent[],
    state: TimelineState,
  ): TimelineState {
    const rows = this.store.db
      .prepare('SELECT id,header FROM feed_origins WHERE owner=? ORDER BY position')
      .all(owner);
    const current = rows.find((row) => row['id'] === id);
    if (!current) throw new Error('Unknown history stream');
    const prefixes = rows
      .map((row) => String(row['id']))
      .filter((key) => key !== 'base')
      .map((key) => `${key}:`);
    const belongs = (value: string, key: string) =>
      key === 'base'
        ? !prefixes.some((prefix) => value.startsWith(prefix))
        : value.startsWith(`${key}:`);
    const local = Timeline.restore({
      ...(JSON.parse(String(current['header'])) as TimelineState),
      items: state.items.filter((item) => belongs(item.id, id)),
      turns: state.turns.filter((turn) => belongs(turn.id, id)),
    });
    for (const event of events) local.apply(event);
    this.store.db.prepare('UPDATE feed_origins SET seq=?,header=? WHERE owner=? AND id=?').run(
      seq,
      JSON.stringify({
        ...local.state,
        items: [],
        turns: local.state.turns.filter(
          (turn, index, all) => !turn.outcome || index >= all.length - 8,
        ),
      }),
      owner,
      id,
    );
    const result = {
      ...state,
      items: rows
        .flatMap((row) =>
          row['id'] === id
            ? local.state.items
            : state.items.filter((item) => belongs(item.id, String(row['id']))),
        )
        .sort((a, b) => a.startedAt - b.startedAt),
      turns: rows.flatMap((row) =>
        row['id'] === id
          ? local.state.turns
          : state.turns.filter((turn) => belongs(turn.id, String(row['id']))),
      ),
    };
    this.combine(owner, result);
    return result;
  }
  private combine(owner: string, state: TimelineState): void {
    const origins = this.store.db
      .prepare('SELECT live,header FROM feed_origins WHERE owner=? ORDER BY position')
      .all(owner)
      .map((row) => ({
        live: Boolean(row['live']),
        state: JSON.parse(String(row['header'])) as TimelineState,
      }));
    const chosen = origins.findLast((origin) => origin.live)?.state ?? origins[0]?.state;
    if (chosen)
      for (const field of ['status', 'session', 'usage', 'limits', 'activity', 'plan'] as const)
        Object.assign(state, { [field]: chosen[field] });
    state.interactions = origins.flatMap((origin) => origin.state.interactions);
    if (state.interactions.some((interaction) => interaction.kind === 'question'))
      state.status = 'waiting';
  }
}
