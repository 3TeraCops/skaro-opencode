import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { completionTaskDeps } from './completion-task-runs';
import { TaskRunEngine } from './task-run-engine';
import { createTaskRun } from './task-run-create';

let fixture: CompletionFixture;
let engine: TaskRunEngine | undefined;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await engine?.sessions.close();
  engine = undefined;
  await fixture.close();
});

it('creates distinct branches and checkouts for milestone tasks concurrently without starting agents', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'New parallel runs' });
  await fixture.context.store.updateMilestone(stage.id, { branch: 'skaro/M01-legacy' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  for (const task of [first, second])
    await fixture.context.store.updateTask(task.id, { branch: undefined });
  await fixture.commit();
  engine = new TaskRunEngine(completionTaskDeps(fixture));
  const active = await Promise.all(
    [first, second].map((task) => createTaskRun(engine!, fixture.projectId, task.id)),
  );
  expect(active[0]!.run.branch).not.toBe(active[1]!.run.branch);
  expect(active[0]!.run.worktree).not.toBe(active[1]!.run.worktree);
  for (const [i, task] of [first, second].entries()) {
    expect(active[i]!.run.worktree).toBe(
      join(fixture.root, 'worktrees', fixture.projectId, task.id),
    );
    expect(active[i]!.run.branch).not.toBe('skaro/M01-legacy');
    expect((await fixture.context.store.readTask(task.id)).branch).toBe(active[i]!.run.branch);
    await engine.stages.sync(fixture.projectId, task.id);
    expect(engine.stages.blocked(`${fixture.projectId}\n${task.id}`)).toBe(false);
    expect(active[i]!.session).toBeUndefined();
  }
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
}, 30_000);

it('the real run factory materializes the accepted dependency before registering a dependent run', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'New dependent run' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id, [first.id]);
  await fixture.commit();
  await fixture.accept(first, await fixture.checkout(first));
  engine = new TaskRunEngine(completionTaskDeps(fixture));
  const active = await createTaskRun(engine, fixture.projectId, second.id);
  const accepted = fixture.journal.result(first.id)!;
  expect(
    (await git(active.run.worktree!, ['merge-base', '--is-ancestor', accepted.head, 'HEAD'])).code,
  ).toBe(0);
  expect(await readFile(join(active.run.worktree!, `${first.id}.txt`), 'utf8')).toBe(
    `${first.id} result\n`,
  );
  expect(fixture.db.getRun(active.run.id)?.worktree).toBe(active.run.worktree);
  expect(active.session).toBeUndefined();
}, 30_000);

it('rejects synthetic milestone runs and in-place review dependencies before changing task records', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Run guards' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id, [first.id]);
  await fixture.commit();
  await fixture.accept(first, await fixture.checkout(first));
  const config = (await fixture.context.load()).config;
  await fixture.context.store.writeConfig({ ...config, isolation: 'in-place' });
  fixture.context.invalidate();
  engine = new TaskRunEngine(completionTaskDeps(fixture));
  await expect(createTaskRun(engine, fixture.projectId, stage.id)).rejects.toThrow(
    'Milestones have no agent sessions',
  );
  await expect(createTaskRun(engine, fixture.projectId, second.id)).rejects.toThrow(
    'in-place task must wait',
  );
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
  expect(fixture.db.listRuns(fixture.projectId, second.id)).toEqual([]);
}, 30_000);
