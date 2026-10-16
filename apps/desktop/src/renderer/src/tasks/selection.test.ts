import { expect, it } from 'vitest';
import { selectTasks } from './selection';

it('selects the entire column without duplicating its already selected tasks', () => {
  expect(selectTasks(['other', 'first'], ['first', 'second', 'blocked'], true)).toEqual([
    'other',
    'first',
    'second',
    'blocked',
  ]);
});

it('deselects only the requested column, preserving other and filtered out selections', () => {
  expect(selectTasks(['other', 'hidden', 'first', 'second'], ['first', 'second'], false)).toEqual([
    'other',
    'hidden',
  ]);
});

it('leaves selection unchanged for an empty column', () => {
  expect(selectTasks(['other'], [], true)).toEqual(['other']);
  expect(selectTasks(['other'], [], false)).toEqual(['other']);
});
