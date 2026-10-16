import { feedRows, Timeline, type TimelineEvent } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { CodexProjector } from './projector.ts';

const noImage = () => {
  throw new Error('Unexpected image');
};

// Wire shapes of the real 0.159 task log: the item carries no status of its own.
const compaction = { type: 'contextCompaction', id: 'c1' };

function feed(completed: boolean, turn: 'completed' | 'failed') {
  const events: TimelineEvent[] = [];
  const projector = new CodexProjector({ now: () => 1, attachImage: noImage }, (e) =>
    events.push(e),
  );
  projector.output({ method: 'turn/started', params: { turn: { id: 't1' } } });
  projector.output({ method: 'item/started', params: { turnId: 't1', item: compaction } });
  const running = feedRows(Timeline.from(events).state).map((row) => row.type);
  if (completed)
    projector.output({ method: 'item/completed', params: { turnId: 't1', item: compaction } });
  projector.output({ method: 'turn/completed', params: { turn: { id: 't1', status: turn } } });
  const state = Timeline.from(events).state;
  return { running, rows: feedRows(state).map((row) => row.type), status: state.items[0]?.status };
}

it('says the context was compacted only once the compaction has finished', () => {
  expect(feed(true, 'completed')).toEqual({
    running: [],
    rows: ['notice', 'turn_end'],
    status: 'done',
  });
  // The remote compaction timed out: the item never completes and the turn fails.
  expect(feed(false, 'failed')).toEqual({ running: [], rows: ['turn_end'], status: 'failed' });
});
