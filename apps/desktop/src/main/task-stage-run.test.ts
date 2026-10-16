import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, indexTasks, isBlocked } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { completionTaskRuns } from './completion-task-runs';
import { acceptedResult } from './completion-results';
import { readLedger, writeLedger } from './task-stage';
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

it('retains accepted SHA provenance in a legacy shared checkout without squashing other task work', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Legacy stage' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id, [first.id]);
  for (const task of [first, second])
    await fixture.context.store.updateTask(task.id, { branch: undefined });
  await fixture.commit();
  const before = await fixture.context.git.head();
  const branch = `skaro/${stage.id}-stage`;
  const checkout = join(fixture.root, 'worktrees', fixture.projectId, stage.id);
  await fixture.context.git.createWorktree({ path: checkout, branch, base: 'main' });
  for (const task of [first, second]) {
    fixture.db.createRun({
      projectId: fixture.projectId,
      taskId: task.id,
      agent: 'codex',
      branch,
      worktree: checkout,
      logPath: `runs/${task.id}.jsonl`,
      adapterVersion: 'test-record-only',
    });
    await writeFile(join(checkout, `${task.id}.txt`), task.id);
    await fixture.review(task.id);
    await fixture.coordinator.capture(
      fixture.projectId,
      task.id,
      branch,
      checkout,
      `feat: ${task.id}`,
    );
  }
  const firstSha = fixture.journal.result(first.id)!.head;
  const secondSha = fixture.journal.result(second.id)!.head;
  expect(firstSha).not.toBe(secondSha);
  expect((await git(fixture.repo, ['merge-base', '--is-ancestor', firstSha, secondSha])).code).toBe(
    0,
  );
  expect(await fixture.context.git.head()).toBe(before);
  const merged = await fixture.coordinator.merge(fixture.projectId, stage.id);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect((await fixture.context.store.readTask(second.id)).status).toBe('done');
  // One merge per task, in the order of their commits on the shared branch.
  expect(fixture.journal.operations().map((op) => op.results.map((result) => result.head))).toEqual(
    [[firstSha], [secondSha]],
  );
  expect(await fixture.context.git.head(branch)).toBe(secondSha);
  expect(merged.commit).not.toBe(secondSha);
  expect(existsSync(checkout)).toBe(true);
}, 30_000);

it('imports a legacy result from its ledger rather than guessing from the current shared tip', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Legacy provenance' });
  const task = await fixture.task('Legacy task', stage.id);
  await fixture.context.store.updateTask(task.id, { branch: undefined });
  await fixture.commit();
  const branch = `skaro/${stage.id}-stage`;
  const checkout = join(fixture.root, 'worktrees', fixture.projectId, stage.id);
  await fixture.context.git.createWorktree({ path: checkout, branch, base: 'main' });
  fixture.db.createRun({
    projectId: fixture.projectId,
    taskId: task.id,
    agent: 'codex',
    branch,
    worktree: checkout,
    logPath: 'runs/legacy.jsonl',
    adapterVersion: 'test-record-only',
  });
  await writeFile(join(checkout, 'accepted.txt'), 'accepted code');
  await fixture.commit(checkout, 'accepted task');
  const accepted = await fixture.context.git.head(branch);
  const ledger = readLedger(fixture.db, fixture.projectId, stage.id);
  ledger.commits.push({ taskId: task.id, commit: accepted, message: 'accepted task' });
  writeLedger(fixture.db, fixture.projectId, stage.id, ledger);
  await writeFile(join(checkout, 'later.txt'), 'different task code');
  await fixture.commit(checkout, 'other task');
  await fixture.context.store.updateTask(task.id, { status: 'review' });
  const result = await acceptedResult(
    fixture.db,
    fixture.context,
    await fixture.context.store.readTask(task.id),
  );
  expect(result.head).toBe(accepted);
  expect(result.head).not.toBe(await fixture.context.git.head(branch));
}, 30_000);

it('shows independent own-branch tasks without an artificial stage wait and retains real dependencies', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Independent stage' });
  const first = await fixture.task('First', stage.id);
  const independent = await fixture.task('Independent', stage.id);
  const dependent = await fixture.task('Dependent', stage.id, [first.id]);
  await fixture.context.store.updateTask(dependent.id, { status: 'todo' });
  await fixture.commit();
  const a = await fixture.checkout(first);
  await fixture.checkout(independent);
  runs = completionTaskRuns(fixture);
  const summaries = await runs.list(fixture.projectId);
  expect(summaries.find((item) => item.id === independent.id)?.after).toBeUndefined();
  expect(summaries.find((item) => item.id === dependent.id)?.waitsFor).toContainEqual(first.id);
  // An accepted dependency does not start the task yet: its merge does.
  await fixture.accept(first, a);
  const blocked = async () => {
    fixture.context.invalidate();
    const artifacts = await fixture.context.load();
    return isBlocked(
      artifacts.tasks.find((item) => item.id === dependent.id)!,
      indexTasks(artifacts.tasks),
    );
  };
  expect(await blocked()).toBe(true);
  await fixture.coordinator.merge(fixture.projectId, first.id);
  expect(await blocked()).toBe(false);
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
}, 30_000);
