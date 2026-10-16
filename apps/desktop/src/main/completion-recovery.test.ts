import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, MergeBlockedError } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { publishCompletion } from './completion-publication';
import { CompletionCoordinator } from './completion-coordinator';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it('replays durable projection after publication and restart without another Git commit', async () => {
  const task = await fixture.task('Publication checkpoint');
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const context = fixture.context;
  const operation = fixture.journal.create('main', [fixture.journal.result(task.id)!], 'squash');
  await publishCompletion(
    context,
    await context.load(),
    fixture.journal,
    operation,
    'feat: checkpoint',
  );
  expect(operation.state).toBe('prepared');
  expect(await context.git.head()).toBe(operation.commit);
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toEqual([]);
  await fixture.restart();
  await fixture.reconcile();
  await fixture.reconcile();
  expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
  expect(await fixture.context.git.head()).toBe(operation.commit);
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toHaveLength(1);
  expect(fixture.journal.operations()[0]?.state).toBe('completed');
}, 30_000);

it('recovers accepted result before its review-file projection was saved', async () => {
  const task = await fixture.task('Acceptance checkpoint');
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  // Recreate the durable checkpoint between saving the SHA and writing task status.
  const saved = fixture.journal.result(task.id)!;
  fixture.journal.saveResult({ ...saved, pendingReview: true });
  await fixture.context.store.updateTask(task.id, { status: 'in_progress', body: task.body });
  await fixture.restart();
  await fixture.reconcile();
  expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
  expect((await fixture.context.store.readTask(task.id)).body).toContain(`Accepted ${task.id}`);
  expect(fixture.journal.result(task.id)?.pendingReview).toBe(false);
}, 30_000);

it.each(['ff', 'merge'] as const)(
  'reconciles an external %s and persists task completion',
  async (strategy) => {
    const task = await fixture.task('External merge');
    await fixture.commit();
    await fixture.accept(task, await fixture.checkout(task));
    if (strategy === 'merge') {
      await writeFile(join(fixture.repo, 'owner.txt'), 'independent owner commit');
      await git(fixture.repo, ['add', 'owner.txt']);
      await git(fixture.repo, ['commit', '-qm', 'owner work']);
    }
    await git(fixture.repo, [
      'merge',
      strategy === 'ff' ? '--ff-only' : '--no-ff',
      '--no-edit',
      task.branch!,
    ]);
    const merged = await fixture.context.git.head();
    await fixture.restart();
    await fixture.reconcile();
    expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
    expect(await fixture.context.git.head()).toBe(merged);
    expect(fixture.journal.operations()[0]).toMatchObject({ state: 'completed', external: true });
    await fixture.restart();
    await fixture.reconcile();
    expect(fixture.db.listMerges(fixture.projectId, task.id)).toHaveLength(1);
  },
  30_000,
);

it('does not infer completion from an unknown external squash', async () => {
  const task = await fixture.task('Unknown rewritten history');
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  await git(fixture.repo, ['merge', '--squash', task.branch!]);
  await git(fixture.repo, ['commit', '-qm', 'external squash']);
  await fixture.restart();
  await fixture.reconcile();
  expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toEqual([]);
}, 30_000);

it('preserves new source edits and changed acceptance instead of closing an externally merged result', async () => {
  const task = await fixture.task('Source changes');
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await fixture.accept(task, worktree);
  await git(fixture.repo, ['merge', '--ff-only', task.branch!]);
  await writeFile(join(worktree, 'later.txt'), 'unsubmitted source work');
  await fixture.reconcile();
  expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
  expect(fixture.errors.join('\n')).toContain('uncommitted changes');
  expect(await readFile(join(worktree, 'later.txt'), 'utf8')).toBe('unsubmitted source work');
  await fixture.context.store.updateTask(task.id, {
    title: 'Changed acceptance requirement',
  });
  fixture.context.invalidate();
  await fixture.reconcile();
  expect(fixture.errors.join('\n')).toContain('acceptance changed');
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toEqual([]);
}, 30_000);

it('merges milestone tasks one by one and hands a conflict to the agent of its task', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Conflicts' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  await fixture.commit();
  const before = await fixture.context.git.head();
  const a = await fixture.checkout(first);
  const b = await fixture.checkout(second);
  await fixture.accept(first, a, 'shared.txt');
  await fixture.accept(second, b, 'shared.txt');
  // Without a run to ask, the conflict is the error of the merge.
  await expect(fixture.coordinator.merge(fixture.projectId, stage.id)).rejects.toBeInstanceOf(
    MergeBlockedError,
  );
  const merged = await fixture.context.git.head();
  expect(merged).not.toBe(before);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect((await fixture.context.store.readTask(second.id)).status).toBe('review');
  expect(await readFile(join(fixture.repo, 'shared.txt'), 'utf8')).toBe(`${first.id} result\n`);
  expect(await readFile(join(b, 'shared.txt'), 'utf8')).toBe(`${second.id} result\n`);
  // With a run, the conflict goes to the agent of the task; no candidate is built for it.
  const handed: [string, string[]][] = [];
  const coordinator = new CompletionCoordinator({
    ...fixture.hooks(),
    conflicted: async (_project, taskId, conflicts) => {
      handed.push([taskId, conflicts]);
      return true;
    },
  });
  await expect(coordinator.merge(fixture.projectId, stage.id)).rejects.toThrow(
    'went back to the task agent',
  );
  await coordinator.close();
  expect(handed).toEqual([[second.id, ['shared.txt']]]);
  expect(await fixture.context.git.head()).toBe(merged);
  expect(fixture.integrations.deps.store.all(fixture.projectId)).toEqual([]);
}, 30_000);
