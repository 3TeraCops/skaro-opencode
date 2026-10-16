import type { Milestone, ProjectArtifacts, Task, TaskRuntime } from '@skaro/core';
import { expect, it } from 'vitest';
import type { IntegrationOperation } from './integration-model';
import { stageInfo } from './stage-views';

const stage: Milestone = { id: 'M07', title: 'Billing', order: 1, body: '', path: '' };

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    milestone: 'M07',
    status: 'todo',
    dependsOn: [],
    unblocked: false,
    archived: false,
    body: '',
    path: '',
    ...patch,
  };
}

type Merge = Pick<IntegrationOperation, 'taskId' | 'purpose' | 'state' | 'executor'>;

function info(
  tasks: Task[],
  runtime: Record<string, TaskRuntime> = {},
  options: { awaiting?: string[]; accepted?: boolean; body?: string; merges?: Merge[] } = {},
) {
  const milestone = { ...stage, body: options.body ?? '' };
  const artifacts = { milestones: [milestone], tasks } as unknown as ProjectArtifacts;
  const states = new Map(Object.entries(runtime).map(([id, state]) => [id, { state }]));
  const result = stageInfo(milestone, artifacts, states, {
    awaiting: new Set(options.awaiting),
    accepted: options.accepted ?? false,
    integrations: (options.merges ?? []) as IntegrationOperation[],
  });
  return [result.state, result.task, `${result.finished}/${result.total}`];
}

it('follows the tasks of a stage from the first start to the last one', () => {
  const a = task('T-1');
  const b = task('T-2', { dependsOn: ['T-1'] });
  expect(info([a, b])).toEqual(['idle', undefined, '0/2']);
  expect(info([a, b], { 'T-1': 'queued' }, { awaiting: ['T-2'] })).toEqual([
    'queued',
    'T-1',
    '0/2',
  ]);
  const started = task('T-1', { status: 'in_progress' });
  expect(info([started, b], { 'T-1': 'running' })).toEqual(['running', 'T-1', '0/2']);
  expect(info([started, b], { 'T-1': 'waiting' })).toEqual(['needs_answer', 'T-1', '0/2']);
  // Started and no agent works on it: it waits for the user.
  expect(info([started, b])).toEqual(['needs_answer', 'T-1', '0/2']);
  expect(info([started, b], { 'T-1': 'failed' })).toEqual(['error', 'T-1', '0/2']);
  const reviewed = task('T-1', { status: 'review' });
  expect(info([reviewed, b], {}, { awaiting: ['T-2'] })).toEqual(['queued', 'T-2', '1/2']);
  expect(info([reviewed, b])).toEqual(['stopped', undefined, '1/2']);
});

it('awaits individual task merges regardless of legacy stage acceptance state', () => {
  const tasks = [task('T-1', { status: 'review' }), task('T-2', { status: 'cancelled' })];
  const body = '## Критерий готовности\n\n- [ ] Works as a whole\n';
  expect(info(tasks, {}, { body })).toEqual(['awaiting_merge', undefined, '1/1']);
  expect(info(tasks, { M07: 'running' }, { body })).toEqual(['awaiting_merge', undefined, '1/1']);
  expect(info(tasks, { M07: 'waiting' }, { body })[0]).toBe('awaiting_merge');
  expect(info(tasks, {}, { body, accepted: true })[0]).toBe('awaiting_merge');
  const ticked = body.replace('[ ]', '[x]');
  expect(info(tasks, {}, { body: ticked, accepted: true })[0]).toBe('awaiting_merge');
  expect(info([task('T-1', { status: 'done' })])[0]).toBe('done');
});

it('says how its merge goes while the merged tasks stay in review', () => {
  const tasks = [task('T-1', { status: 'review' }), task('T-2', { status: 'review' })];
  const merge = (patch: Partial<Merge>): Merge => ({
    taskId: 'T-1',
    purpose: 'publication',
    state: 'resolving',
    ...patch,
  });
  expect(info(tasks, {}, { merges: [merge({ executor: 'lease' })] })).toEqual([
    'running',
    'T-1',
    '2/2',
  ]);
  expect(info(tasks, {}, { merges: [merge({ state: 'failed' })] })).toEqual([
    'error',
    'T-1',
    '2/2',
  ]);
  // A later merge supersedes the failed one; a stale mark on a task in review is no error.
  expect(
    info(tasks, { 'T-2': 'failed' }, { merges: [merge({ state: 'failed' }), merge({})] })[0],
  ).toBe('awaiting_merge');
  // The merge of another stage and the preparation of a task say nothing about this one.
  const other = [merge({ taskId: 'T-9', state: 'failed' }), merge({ purpose: 'dependencies' })];
  expect(info(tasks, {}, { merges: other })[0]).toBe('awaiting_merge');
});

it('says which task of another stage an unstarted stage waits for', () => {
  const dep = task('T-8', { milestone: 'M06', status: 'in_progress' });
  const first = task('T-9', { dependsOn: ['T-8'] });
  const artifacts = { milestones: [stage], tasks: [dep, first] } as unknown as ProjectArtifacts;
  const result = stageInfo(stage, artifacts, new Map(), {
    awaiting: new Set(),
    accepted: false,
    integrations: [],
  });
  expect(result).toMatchObject({ state: 'idle', waitsFor: { task: 'T-8', stage: 'M06' } });
});
