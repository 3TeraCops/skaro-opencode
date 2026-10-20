// Replay only recorded native sessions from an isolated real profile; no generated events.
import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AttachmentStore } from '@skaro/core';
import { Timeline, type TimelineEvent, type TimelineState } from '@skaro/timeline';
import { replayHistory } from '../src/main/background/history-replay';
import { PayloadStore } from '../src/main/background/payload-store';
import { HistorySnapshots } from '../src/main/background/history-snapshots';
import { canRetireHistory } from '../src/main/history-memory';
import { HistoryIndex } from '../src/main/background/history-index';
import { feedRows } from '@skaro/timeline';
import { feedText } from '../src/shared/history-text';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const chatId = process.env['SKARO_MEMORY_CHAT'];
test.skip(
  !profile || !chatId,
  'Requires an existing recorded native chat in the real copied profile',
);

interface Growth {
  before: TimelineState;
  event: Extract<TimelineEvent, { t: 'item.append' }>;
  seq: number;
}
async function recordedHistory(check: (timeline: Timeline, event: TimelineEvent) => void) {
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId!);
  db.close();
  if (!chat) throw new Error('The recorded chat is missing');
  const timeline = new Timeline();
  const segments = await replayHistory(
    join(profile!, String(chat['log_path'])),
    Number(chat['created_at']),
    String(chat['agent']),
    new AttachmentStore(join(profile!, 'attachments')).context(),
    (event) => check(timeline, event),
  );
  return { timeline, segments };
}

test('accounts real text growth, replacements and running work without rescanning completed history', async () => {
  test.setTimeout(180_000);
  let events = 0;
  const kinds = new Set<string>();
  const { timeline, segments } = await recordedHistory((timeline, event) => {
    events++;
    kinds.add(event.t);
    timeline.apply(event);
    if (events % 200 !== 0 && event.t !== 'turn.completed' && event.t !== 'rewound') return;
    // Rebuilding from the actual current snapshot is an independent restoration path.
    const restored = Timeline.restore(structuredClone(timeline.state));
    expect(timeline.retainedBytes).toBe(restored.retainedBytes);
    const running = timeline.state.items.some(
      (item) =>
        item.status === 'running' ||
        (item.kind === 'command' && item.background?.state === 'running'),
    );
    expect(timeline.hasRunningItems).toBe(running);
    expect(canRetireHistory(timeline)).toBe(
      timeline.state.status === 'idle' && !timeline.state.interactions.length && !running,
    );
  });
  expect(events).toBeGreaterThan(200);
  expect(kinds.has('item.append')).toBe(true);
  expect(kinds.has('item.upsert')).toBe(true);
  expect(kinds.has('turn.completed')).toBe(true);
  const hydrated = Timeline.restore({ ...structuredClone(timeline.state), items: [] });
  for (let at = 0; at < timeline.state.items.length; at += 32)
    hydrated.restoreItems(timeline.state.items.slice(at, at + 32));
  expect(hydrated.retainedBytes).toBe(timeline.retainedBytes);
  expect(hydrated.hasRunningItems).toBe(timeline.hasRunningItems);
  expect(hydrated.state).toEqual(timeline.state);
  console.log('Actual history memory:', {
    events,
    segments,
    items: timeline.state.items.length,
    retainedEstimate: timeline.retainedBytes,
    kinds: [...kinds],
  });
});

test('evicts a real history after recorded growth and restores its full text from SQLite', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  let growth: Growth | undefined;
  let seq = 0;
  await recordedHistory((timeline, event) => {
    seq++;
    if (
      !growth &&
      timeline.retainedBytes > 512_000 &&
      event.t === 'item.append' &&
      event.chunk.length
    ) {
      const item = timeline.item(event.itemId);
      if (
        (event.field === 'text' && (item?.kind === 'message' || item?.kind === 'reasoning')) ||
        (event.field === 'output' && item?.kind === 'command')
      )
        growth = {
          before: structuredClone(timeline.state),
          event: structuredClone(event),
          seq: seq - 1,
        };
    }
    timeline.apply(event);
  });
  expect(growth).toBeDefined();
  const actual = growth!;
  const expected = Timeline.restore(structuredClone(actual.before));
  const budget = expected.retainedBytes;
  expected.apply(actual.event);
  const file = info.outputPath('workspace.db');
  mkdirSync(dirname(file), { recursive: true });
  // This is the real persistent read-model store, populated only from the recorded history.
  const store = new PayloadStore(dirname(file));
  try {
    for (const mode of ['warm', 'cold'] as const) {
      const snapshots = new HistorySnapshots(store, mode === 'warm' ? budget : 0);
      const metadata = store.transaction(() =>
        snapshots.save(chatId!, structuredClone(actual.before)),
      );
      snapshots.trim();
      expect(snapshots.retainedBytes).toBe(mode === 'warm' ? budget : 0);
      const items = store.transaction(() => snapshots.append(chatId!, [actual.event]));
      const expected = Timeline.restore(structuredClone(actual.before));
      expected.apply(actual.event);
      expect(items.get(actual.event.itemId)).toEqual(expected.item(actual.event.itemId));
      if (mode === 'warm') expect(snapshots.retainedBytes).toBeGreaterThan(budget);
      else expect(snapshots.retainedBytes).toBe(0);
      snapshots.trim();
      expect(snapshots.retainedBytes).toBe(0);
      const restored = snapshots.load(chatId!, metadata);
      expect(restored.state).toEqual(JSON.parse(JSON.stringify(expected.state)));
      expect(restored.retainedBytes).toBe(expected.retainedBytes);
      snapshots.trim();
      expect(snapshots.retainedBytes).toBe(0);
      // A caller still owns its complete snapshot when the cache releases its reference.
      expect(restored.state.items.length).toBe(actual.before.items.length);
      expect(restored.item(actual.event.itemId)).toEqual(items.get(actual.event.itemId));
    }
    const index = new HistoryIndex(store, 0);
    const owner = `${chatId}:indexed`;
    const before = index.withSnapshot(() =>
      index.initialize(owner, `recorded:${actual.seq}`, structuredClone(actual.before), [
        { id: 'base', seq: actual.seq, live: true, timeline: structuredClone(actual.before) },
      ]),
    );
    const after = index.withSnapshot(() =>
      index.events(owner, [actual.event], `recorded:${actual.seq + 1}`, {
        id: 'base',
        seq: actual.seq + 1,
      }),
    );
    expect(after?.source.itemCount).toBe(actual.before.items.length);
    expect(after?.source.count).toBe(before.source.count);
    expect(after?.source.revision).toBe(before.source.revision + 1);
    const persisted = index.withSnapshot(() => index.state(after!.source));
    expect(feedText(feedRows(persisted))).toBe(feedText(feedRows(expected.state)));
    expect(
      store.db.prepare('SELECT seq FROM feed_origins WHERE owner=? AND id=?').get(owner, 'base')?.[
        'seq'
      ],
    ).toBe(actual.seq + 1);
    // Use SQLite's actual read-only mode to verify recovery from a rejected write.
    const writable = new HistoryIndex(store);
    const original = writable.withSnapshot(() =>
      writable.initialize(owner, `recorded:${actual.seq}`, structuredClone(actual.before)),
    );
    store.db.exec('PRAGMA query_only=ON');
    try {
      expect(() =>
        writable.withSnapshot(() =>
          writable.events(owner, [actual.event], `recorded:${actual.seq + 1}`),
        ),
      ).toThrow();
    } finally {
      store.db.exec('PRAGMA query_only=OFF');
    }
    const recovered = writable.withSnapshot(() => writable.state(original.source));
    expect(recovered).toEqual(JSON.parse(JSON.stringify(actual.before)));
    expect(writable.matches(owner, `recorded:${actual.seq}`)?.source.revision).toBe(
      original.source.revision,
    );
    const retried = writable.withSnapshot(() =>
      writable.events(owner, [actual.event], `recorded:${actual.seq + 1}`),
    );
    const complete = writable.withSnapshot(() => writable.state(retried!.source));
    expect(feedText(feedRows(complete))).toBe(feedText(feedRows(expected.state)));
    console.log('Real history cache growth:', { budget, after: expected.retainedBytes });
  } finally {
    store.db.close();
  }
});
