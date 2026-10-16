import { expect, it } from 'vitest';
import { continuationTimeline, runEvent } from './run-history.ts';
import { Timeline } from './state.ts';
import type { TimelineEvent } from './model.ts';

it('keeps identical native ids from different agents separate, including append and parent references', () => {
  const events: TimelineEvent[] = [
    { t: 'turn.started', turnId: '1' },
    {
      t: 'item.upsert',
      item: {
        id: '1',
        turnId: '1',
        parentId: 'parent',
        kind: 'command',
        command: 'node --version',
        output: '',
        outputLive: true,
        status: 'running',
        startedAt: 1,
        native: { agent: 'codex', type: 'command', ref: '1' },
      },
    },
    { t: 'item.append', itemId: '1', field: 'output', chunk: 'v24' },
    { t: 'turn.completed', turnId: '1', outcome: 'done' },
  ];
  const history = Timeline.from(events);
  for (const event of events) history.apply(runEvent(event, 'next'));
  expect(history.state.items.map((i) => [i.id, i.parentId])).toEqual([
    ['1', 'parent'],
    ['next:1', 'next:parent'],
  ]);
  expect(history.state.items.every((i) => i.kind === 'command' && i.output === 'v24')).toBe(true);
  expect(history.state.turns.map((t) => t.id)).toEqual(['1', 'next:1']);
  expect(
    runEvent(
      {
        t: 'interaction.opened',
        interaction: { id: 'q', itemId: '1', kind: 'question', questions: [] },
      },
      'next',
    ),
  ).toMatchObject({ interaction: { id: 'next:q', itemId: 'next:1' } });
  expect(
    runEvent({ t: 'interaction.closed', id: 'q', resolution: 'expired' }, 'next'),
  ).toMatchObject({ id: 'next:q' });
});

it('carries historical failures and merge cards but clears limits, live tools and native permissions', () => {
  const previous = Timeline.from([
    { t: 'turn.started', turnId: 'unfinished' },
    { t: 'limits', state: 'exhausted', resetsAt: 'tomorrow' },
    { t: 'usage', inputTokens: 100, outputTokens: 10 },
    { t: 'plan.updated', steps: [{ id: 'p', text: 'check', status: 'active' }] },
    {
      t: 'interaction.opened',
      interaction: {
        id: 'permission',
        kind: 'approval',
        action: { type: 'command', title: 'run' },
        choices: ['allow_once', 'deny'],
      },
    },
    {
      t: 'interaction.opened',
      interaction: {
        id: 'merge',
        kind: 'merge',
        from: 'task',
        to: 'main',
        files: 1,
        added: 1,
        removed: 0,
        blockers: [],
        baseAhead: 0,
        skaroChanges: [],
        conflicts: [],
      },
    },
  ]);
  const next = continuationTimeline(previous.state);
  expect(next.state.status).toBe('idle');
  expect(next.state.turns[0]?.outcome).toBe('interrupted');
  expect(next.state.interactions.map((i) => i.id)).toEqual(['merge']);
  expect(next.state.limits).toBeUndefined();
  expect(next.state.usage).toBeUndefined();
  expect(next.state.plan).toBeUndefined();
  expect(previous.state.interactions).toHaveLength(2);
  expect(previous.state.turns[0]?.outcome).toBeUndefined();
});
