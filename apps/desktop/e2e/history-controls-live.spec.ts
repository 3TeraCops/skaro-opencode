import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { Timeline } from '@skaro/timeline';
import { PayloadStore } from '../src/main/background/payload-store';
import { HistoryIndex } from '../src/main/background/history-index';
import { historyRows } from '../src/main/background/history-rows';
import { recordedControlSamples } from './recorded-control-samples';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(
  !profile || !project,
  'Requires actual recorded native histories in the separate test project',
);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('updates recorded controls without changing history rows, including eviction and transaction failure', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const recorded = await recordedControlSamples(profile!, project!);
  expect(recorded.samples.length).toBeGreaterThan(3);
  const directory = info.outputPath('read-model');
  mkdirSync(directory, { recursive: true });
  const store = new PayloadStore(directory);
  const measurements: { type: string; mode: string; writes: number; ms: number; items: number }[] =
    [];
  try {
    for (const budget of [0, 32 * 1024 * 1024]) {
      const index = new HistoryIndex(store, budget);
      for (const origin of [false, true]) {
        for (const [at, sample] of recorded.samples.entries()) {
          const owner = `${budget}:${origin}:${at}`;
          const before = index.withSnapshot(() =>
            index.initialize(
              owner,
              'before',
              structuredClone(sample.before),
              origin
                ? [
                    {
                      id: 'base',
                      seq: 0,
                      live: true,
                      timeline: { ...structuredClone(sample.before), items: [] },
                    },
                  ]
                : undefined,
            ),
          );
          const canonical = Timeline.restore(structuredClone(sample.before));
          canonical.apply(sample.event);
          const changes = () => Number(store.db.prepare('SELECT total_changes() AS n').get()!['n']);
          if (at === 0) {
            store.db.exec('PRAGMA query_only=ON');
            try {
              expect(() =>
                index.withSnapshot(() =>
                  index.events(
                    owner,
                    [sample.event],
                    'rejected',
                    origin ? { id: 'base', seq: 1 } : undefined,
                  ),
                ),
              ).toThrow();
            } finally {
              store.db.exec('PRAGMA query_only=OFF');
            }
            expect(index.withSnapshot(() => index.state(before.source))).toEqual(
              json(sample.before),
            );
            expect(index.matches(owner, 'before')?.source.revision).toBe(before.source.revision);
            if (origin)
              expect(
                store.db.prepare('SELECT seq FROM feed_origins WHERE owner=?').get(owner)?.['seq'],
              ).toBe(0);
          }
          const beforeUpdate = changes();
          const start = performance.now();
          const updated = index.withSnapshot(() =>
            index.events(
              owner,
              [sample.event],
              'after',
              origin ? { id: 'base', seq: 1 } : undefined,
            ),
          )!;
          measurements.push({
            type: sample.event.t,
            mode: `${budget ? 'warm' : 'evicted'}:${origin}`,
            writes: changes() - beforeUpdate,
            ms: performance.now() - start,
            items: sample.before.items.length,
          });
          expect(changes() - beforeUpdate).toBe(origin ? 2 : 1);
          expect(updated.source.count).toBe(before.source.count);
          expect(updated.source.revision).toBe(before.source.revision + 1);
          expect(updated.source.contentRevision).toBe(before.source.contentRevision);
          expect(updated.source.changeRevision).toBe(before.source.changeRevision);
          const { items: _items, turns: _turns, ...controls } = json(canonical.state);
          expect(updated.timeline).toEqual({ ...json(before.timeline), ...controls });
          if (origin)
            expect(
              store.db.prepare('SELECT seq FROM feed_origins WHERE owner=?').get(owner)?.['seq'],
            ).toBe(1);
          expect(index.withSnapshot(() => index.state(updated.source))).toEqual(
            json(canonical.state),
          );
          const blocks = new Map<string, unknown>();
          historyRows(canonical.state, (key, rows) => {
            blocks.set(key, json(rows));
            return { owner, key, revision: 0, count: rows.length };
          });
          for (const [key, rows] of blocks) {
            const saved = store.db
              .prepare('SELECT value FROM feed_blocks WHERE owner=? AND key=? ORDER BY position')
              .all(owner, key)
              .map((row) => JSON.parse(String(row['value'])));
            expect(saved).toEqual(rows);
          }
          if (sample.next) {
            canonical.apply(sample.next);
            const following = index.withSnapshot(() =>
              index.events(
                owner,
                [sample.next!],
                'next',
                origin ? { id: 'base', seq: 2 } : undefined,
              ),
            )!;
            expect(index.withSnapshot(() => index.state(following.source))).toEqual(
              json(canonical.state),
            );
          }
        }
      }
    }
    console.log(
      'Recorded control updates:',
      JSON.stringify({
        events: recorded.events,
        chats: recorded.chats,
        samples: recorded.samples.length,
        waitingSamples: recorded.samples.filter((sample) =>
          sample.before.interactions.some((interaction) => interaction.kind === 'question'),
        ).length,
        measurements,
      }),
    );
  } finally {
    store.db.close();
  }
});
