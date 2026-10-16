import type { ItemStatus, TimelineEvent } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { UnstartedInputs } from './integration-unstarted-inputs';

function sent(status: ItemStatus): TimelineEvent {
  return {
    t: 'item.upsert',
    item: {
      id: 'message',
      turnId: 'turn-1',
      kind: 'message',
      role: 'user',
      text: 'continue',
      status,
      startedAt: 0,
      native: { agent: 'claude-code', type: 'user', ref: 'message' },
    },
  };
}

it('keeps waiting for the turn of a message the agent has not picked up', () => {
  const inputs = new UnstartedInputs();
  expect(inputs.waiting).toBe(false);
  // Order of a resumed Claude session: the stopped background command ends a turn first.
  inputs.observe(sent('queued'));
  inputs.observe({ t: 'turn.completed', turnId: 'turn-1', outcome: 'done' });
  expect(inputs.waiting).toBe(true);
  inputs.observe(sent('done'));
  expect(inputs.waiting).toBe(false);
});

it('stops waiting for a message the agent cancelled', () => {
  const inputs = new UnstartedInputs();
  inputs.observe(sent('queued'));
  inputs.observe(sent('interrupted'));
  expect(inputs.waiting).toBe(false);
});
