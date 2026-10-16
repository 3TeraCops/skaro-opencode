import { expect, it } from 'vitest';
import { TaskStartState } from './task-start-state';

it('starts immediately and stays pending through empty snapshots until the feed appears', () => {
  const state = { pending: false };
  const start = new TaskStartState(state);
  expect(start.begin()).toBe(true);
  expect(state.pending).toBe(true);
  // An acknowledged request without feed items is still the startup delay.
  start.update({ hasFeed: false, queued: false, error: false });
  start.update({ hasFeed: false, queued: false, error: false });
  expect(state.pending).toBe(true);
  start.update({ hasFeed: true, queued: false, error: false });
  expect(state.pending).toBe(false);
});

it('blocks repeated clicks during startup and allows retry after a failed request', () => {
  const state = { pending: false };
  const start = new TaskStartState(state);
  expect(start.begin()).toBe(true);
  expect(start.begin()).toBe(false);
  start.cancel();
  expect(start.begin()).toBe(true);
  start.update({ hasFeed: false, queued: false, error: true });
  expect(state.pending).toBe(false);
  expect(start.begin()).toBe(true);
});

it('hands over to the existing queue state when execution cannot start yet', () => {
  const state = { pending: false };
  const start = new TaskStartState(state);
  start.begin();
  start.update({ hasFeed: false, queued: true, error: false });
  expect(state.pending).toBe(false);
});
