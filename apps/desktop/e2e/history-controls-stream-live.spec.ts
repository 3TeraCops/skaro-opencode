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
  'Requires actual recorded histories from the separate test project',
);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('keeps the complete recorded question and message streams equivalent to canonical replay', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const recorded = await recordedControlSamples(profile!, project!);
  const directory = info.outputPath('read-model');
  mkdirSync(directory, { recursive: true });
  const store = new PayloadStore(directory);
  let waitingControls = 0;
  try {
    for (const budget of [0, 32 * 1024 * 1024]) {
      const index = new HistoryIndex(store, budget);
      for (const [chat, stream] of recorded.streams.entries()) {
        const owner = `stream:${budget}:${chat}`;
        const canonical = new Timeline();
        let view = index.withSnapshot(() =>
          index.initialize(owner, '0', structuredClone(canonical.state)),
        );
        for (const [at, event] of stream.entries()) {
          const previous = view.source;
          canonical.apply(event);
          view = index.withSnapshot(() => index.events(owner, [event], String(at + 1)))!;
          expect(view.source.revision).toBe(previous.revision + 1);
          expect(view.source.contentRevision).toBe(
            ['session.started', 'plan.updated', 'usage', 'limits', 'activity', 'status'].includes(
              event.t,
            )
              ? previous.contentRevision
              : view.source.revision,
          );
          const { items: _items, turns: _turns, ...controls } = json(canonical.state);
          const { items: _headerItems, turns: _headerTurns, ...shown } = json(view.timeline);
          expect(shown).toEqual(controls);
          if (canonical.state.interactions.some((interaction) => interaction.kind === 'question')) {
            expect(view.timeline.status).toBe('waiting');
            waitingControls++;
          }
          if (at % 100 === 0 || event.t.startsWith('interaction.') || event.t === 'turn.completed')
            expect(index.withSnapshot(() => index.state(view.source))).toEqual(
              json(canonical.state),
            );
        }
        expect(index.withSnapshot(() => index.state(view.source))).toEqual(json(canonical.state));
        historyRows(canonical.state, (key, blocks) => {
          const saved = store.db
            .prepare('SELECT value FROM feed_blocks WHERE owner=? AND key=? ORDER BY position')
            .all(owner, key)
            .map((row) => JSON.parse(String(row['value'])));
          expect(saved).toEqual(json(blocks));
          return { owner, key, revision: 0, count: blocks.length };
        });
      }
    }
    expect(waitingControls).toBeGreaterThan(0);
    console.log(
      'Complete recorded streams:',
      JSON.stringify({
        eventsPerMode: recorded.events,
        chatsPerMode: recorded.chats,
        waitingControls,
      }),
    );
  } finally {
    store.db.close();
  }
});
