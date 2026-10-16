import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeTaskTool, submitResultTool, type SkaroScope } from '@skaro/mcp-server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { completionTaskRuns } from './completion-task-runs';
import type { TaskRuns } from './tasks';

let fixture: CompletionFixture;
let runs: TaskRuns | undefined;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await runs?.close();
  runs = undefined;
  await fixture.close();
});

it.each(['task', 'project_chat'] as const)(
  'merges through the actual %s tool route and closes real task cards',
  async (kind) => {
    const stage = await fixture.context.store.createMilestone({ title: 'Chat routes' });
    const first = await fixture.task('First', stage.id);
    const second = await fixture.task('Second', stage.id);
    await fixture.commit();
    const a = await fixture.checkout(first);
    const b = await fixture.checkout(second);
    await Promise.all([fixture.accept(first, a), fixture.accept(second, b)]);
    runs = completionTaskRuns(fixture);
    const view = await runs.open(fixture.projectId, first.id);
    expect(view.timeline?.interactions.some((item) => item.kind === 'merge')).toBe(true);
    const scope: SkaroScope =
      kind === 'task'
        ? { kind, projectId: fixture.projectId, taskId: first.id, runId: view.run!.id }
        : { kind, projectId: fixture.projectId };
    const tool = mergeTaskTool((args, current) => runs!.mergeTask(args, current));
    // A task merges itself; the project chat may ask for every accepted task of a milestone.
    const args = kind === 'task' ? {} : { milestone_id: stage.id };
    const result = await tool.call(args, scope);
    expect(result.isError).not.toBe(true);
    const merged = kind === 'task' ? [first] : [first, second];
    for (const task of merged) {
      expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
      expect((await runs.open(fixture.projectId, task.id)).timeline?.interactions).toEqual([]);
      expect(fixture.db.listMerges(fixture.projectId, task.id)).toHaveLength(1);
    }
    if (kind === 'task')
      expect((await fixture.context.store.readTask(second.id)).status).toBe('review');
    expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
    const before = await fixture.context.git.head();
    expect((await tool.call(args, scope)).isError).not.toBe(true);
    if (kind === 'project_chat') {
      await fixture.context.store.updateTask(first.id, { archived: true });
      await fixture.context.store.updateTask(second.id, { archived: true });
      fixture.context.invalidate();
      expect((await tool.call({ milestone_id: stage.id }, scope)).isError).not.toBe(true);
    }
    expect(await fixture.context.git.head()).toBe(before);
    expect(fixture.journal.operations()).toHaveLength(merged.length);
  },
  30_000,
);

it('shows the merge card of a milestone task in its own chat and merges that task alone', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Task card' });
  const task = await fixture.task('Actual task', stage.id);
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  runs = completionTaskRuns(fixture);
  const view = await runs.open(fixture.projectId, task.id);
  const card = view.timeline!.interactions.find((item) => item.kind === 'merge')!;
  expect(card.kind === 'merge' && card.stage).toBeUndefined();
  await runs.merge(fixture.projectId, task.id, card.id, {
    action: 'confirm',
    message: 'feat: accepted stage',
  });
  expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
  expect(fixture.journal.operations()[0]?.state).toBe('completed');
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
}, 30_000);

it('merges the accepted tasks of a milestone for the project chat and rejects ambiguous or import scope', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Partial merge' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  await fixture.commit();
  await fixture.accept(first, await fixture.checkout(first));
  runs = completionTaskRuns(fixture);
  const tool = mergeTaskTool((args, current) => runs!.mergeTask(args, current));
  const scope: SkaroScope = { kind: 'project_chat', projectId: fixture.projectId };
  expect((await tool.call({}, scope)).isError).toBe(true);
  expect((await tool.call({ task_id: first.id, milestone_id: stage.id }, scope)).isError).toBe(
    true,
  );
  expect(
    (await tool.call({ milestone_id: stage.id }, { ...scope, importId: 'import' })).isError,
  ).toBe(true);
  expect((await tool.call({ milestone_id: stage.id }, scope)).isError).not.toBe(true);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect((await fixture.context.store.readTask(second.id)).status).toBe('in_progress');
  await fixture.accept(second, await fixture.checkout(second));
  expect((await tool.call({ milestone_id: stage.id }, scope)).isError).not.toBe(true);
  expect((await fixture.context.store.readTask(second.id)).status).toBe('done');
  expect(fixture.journal.operations()).toHaveLength(2);
}, 30_000);

it('submit_result saves review truthfully and shows each task its own merge card', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Submit routes' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  await fixture.commit();
  const a = await fixture.checkout(first);
  const b = await fixture.checkout(second);
  await writeFile(join(a, 'first.txt'), 'first code');
  await writeFile(join(b, 'second.txt'), 'second code');
  runs = completionTaskRuns(fixture);
  const tool = submitResultTool((args, scope) => runs!.submitResult(args, scope));
  for (const task of [first, second]) {
    const view = await runs.open(fixture.projectId, task.id);
    const result = await tool.call(
      {
        summary: 'Accepted result',
        commit_message: `feat: ${task.id}`,
        criteria: [{ number: 1, met: true, evidence: 'real source fixture inspected' }],
      },
      { kind: 'task', projectId: fixture.projectId, taskId: task.id, runId: view.run!.id },
    );
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain('in review and awaiting merge');
    expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
    expect(
      (await runs.open(fixture.projectId, task.id)).timeline?.interactions.some(
        (item) => item.kind === 'merge',
      ),
    ).toBe(true);
  }
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
}, 30_000);
