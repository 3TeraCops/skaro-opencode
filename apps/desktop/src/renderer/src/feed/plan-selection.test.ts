import { expect, it } from 'vitest';
import { togglePlanTask } from './plan-selection';
import type { ProposedTask } from '@skaro/timeline';

it('selects prerequisite chains and deselects dependents without touching created tasks', () => {
  const tasks: ProposedTask[] = [
    { ref: 'a', title: 'a', dependsOn: [], dependsOnTitles: [], body: '' },
    { ref: 'b', title: 'b', dependsOn: ['a'], dependsOnTitles: ['a'], body: '' },
    { ref: 'c', title: 'c', dependsOn: ['b'], dependsOnTitles: ['b'], body: '' },
  ];
  const selected = togglePlanTask(tasks, new Set(), 'c', new Set());
  expect([...selected].sort()).toEqual(['a', 'b', 'c']);
  expect([...togglePlanTask(tasks, selected, 'a', new Set())]).toEqual([]);
  expect([...togglePlanTask(tasks, selected, 'a', new Set(['a']))].sort()).toEqual(['a', 'b', 'c']);
});
