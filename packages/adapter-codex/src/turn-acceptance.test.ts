import { expect, it } from 'vitest';
import { TurnControl } from './turn-control.ts';

it('keeps accepted work active before the start notification and until completion', () => {
  const turns = new TurnControl();
  turns.accepted('accepted-turn');
  expect(turns.active).toBe('accepted-turn');
  turns.observe({ t: 'turn.started', turnId: 'accepted-turn' });
  turns.observe({ t: 'turn.completed', turnId: 'accepted-turn', outcome: 'done' });
  expect(turns.active).toBeUndefined();
});

it('does not resurrect a turn that finished before its RPC reply', () => {
  const turns = new TurnControl();
  turns.observe({ t: 'turn.started', turnId: 'completed-turn' });
  turns.observe({ t: 'turn.completed', turnId: 'completed-turn', outcome: 'failed' });
  turns.accepted('completed-turn');
  expect(turns.active).toBeUndefined();
  turns.accepted('next-turn');
  expect(turns.active).toBe('next-turn');
});
