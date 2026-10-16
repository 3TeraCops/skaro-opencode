import { expect, it } from 'vitest';
import { Timeline, type TimelineEvent } from '@skaro/timeline';
import { TaskFeedState } from './feed-state';
import type { TaskView } from '../../../shared/ipc';

it('keeps independent cursors, skips duplicate deltas and does not roll back a newer stream', () => {
  const feed = new TaskFeedState();
  const view = {
    seq: 0,
    timelineSources: {
      integrations: [
        {
          id: 'candidate',
          seq: 1,
          live: true,
          timeline: Timeline.from([
            {
              t: 'item.upsert',
              item: {
                id: 'scoped',
                turnId: '',
                kind: 'message',
                role: 'agent',
                text: 'A',
                status: 'done',
                startedAt: 1,
                native: { agent: 'codex', type: 'message', ref: 'm' },
              },
            },
          ]).state,
        },
      ],
    },
  } as TaskView;
  feed.restore(view);
  const batch = {
    projectId: 'p',
    taskId: 't',
    integrationId: 'candidate',
    seq: 1,
    events: [{ t: 'item.append', itemId: 'scoped', field: 'text', chunk: 'B' } as TimelineEvent],
  };
  expect(feed.integration(batch)).toBe(true);
  expect(feed.integration(batch)).toBe(true);
  feed.restore(view);
  expect(feed.state.items[0]).toMatchObject({ text: 'AB' });
  expect(feed.integration({ ...batch, seq: 3 })).toBe(false);
  expect(feed.integration({ ...batch, integrationId: 'another' })).toBe(false);
});

it('resolver completion leaves task approvals and native model intact', () => {
  const feed = new TaskFeedState();
  const base = Timeline.from([
    { t: 'session.started', nativeSessionId: 'native', model: 'task-model', capabilities: {} },
    {
      t: 'interaction.opened',
      interaction: {
        kind: 'approval',
        id: 'native-approval',
        action: { type: 'command', title: 'Command' },
        choices: ['allow_once', 'deny'],
      },
    },
  ]).state;
  feed.restore({
    seq: 0,
    timelineSources: {
      base,
      integrations: [{ id: 'candidate', seq: 0, live: false, timeline: new Timeline().state }],
    },
  } as TaskView);
  feed.integration({
    projectId: 'p',
    taskId: 't',
    integrationId: 'candidate',
    seq: 0,
    events: [
      { t: 'turn.started', turnId: 'resolver' },
      { t: 'turn.completed', turnId: 'resolver', outcome: 'done' },
    ],
  });
  expect(feed.state.session?.model).toBe('task-model');
  expect(feed.state.interactions).toEqual(base.interactions);
  expect(base.turns).toEqual([]);
});
