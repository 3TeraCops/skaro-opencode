import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { CompletionFixture } from './completion-test-support';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it.each(['squash', 'merge', 'rebase'] as const)(
  'publishes concurrent milestone results together using %s and keeps source heads immutable',
  async (strategy) => {
    const context = fixture.context;
    const stage = await context.store.createMilestone({ title: 'Parallel stage' });
    const tasks = [await fixture.task('First', stage.id), await fixture.task('Second', stage.id)];
    const config = (await context.load()).config;
    await context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    await fixture.commit();
    const before = await context.git.head();
    const checkouts = await Promise.all(tasks.map((task) => fixture.checkout(task)));
    await Promise.all(tasks.map((task, i) => fixture.accept(task, checkouts[i]!)));
    const heads = tasks.map((task) => fixture.journal.result(task.id)!.head);
    const results = await Promise.all([
      fixture.coordinator.merge(fixture.projectId, stage.id),
      fixture.coordinator.merge(fixture.projectId, stage.id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await context.git.head()).toBe(results[0]!.commit);
    expect(fixture.journal.operations()).toHaveLength(1);
    for (const [index, task] of tasks.entries()) {
      expect((await context.store.readTask(task.id)).status).toBe('done');
      expect((await git(fixture.repo, ['show', `HEAD:${task.path}`])).stdout).toContain(
        'status: done',
      );
      expect(await context.git.head(task.branch!)).toBe(heads[index]);
      expect(await readFile(join(fixture.repo, `${task.id}.txt`), 'utf8')).toBe(
        `${task.id} result\n`,
      );
      expect(fixture.db.listMerges(fixture.projectId, task.id)).toHaveLength(1);
    }
    if (strategy === 'squash')
      expect(
        Number((await git(fixture.repo, ['rev-list', '--count', `${before}..HEAD`])).stdout),
      ).toBe(1);
    const commit = results[0]!.commit;
    await fixture.restart();
    await fixture.reconcile();
    expect((await fixture.coordinator.merge(fixture.projectId, stage.id)).commit).toBe(commit);
    expect(fixture.journal.operations()).toHaveLength(1);
  },
  30_000,
);

it('automatically completes a ready milestone without any chat or synthetic run', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Automatic stage' });
  const first = await fixture.task('First', stage.id);
  const second = await fixture.task('Second', stage.id);
  await fixture.commit();
  const a = await fixture.checkout(first);
  const b = await fixture.checkout(second);
  fixture.db.setSetting(AUTO_MERGE_KEY, true);
  fixture.coordinator.start();
  await fixture.accept(first, a);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('review');
  await fixture.accept(second, b);
  await expect
    .poll(
      async () => ({
        status: (await fixture.context.store.readTask(second.id)).status,
        errors: fixture.errors,
      }),
      { timeout: 20_000 },
    )
    .toEqual({ status: 'done', errors: [] });
  await expect
    .poll(() => fixture.journal.operations().some((op) => op.state === 'completed'), {
      timeout: 10_000,
    })
    .toBe(true);
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect(fixture.db.listRuns(fixture.projectId, stage.id)).toEqual([]);
  expect(fixture.db.listMerges(fixture.projectId, first.id)).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
}, 30_000);

it('preserves unrelated staged, unstaged, untracked and ignored owner data', async () => {
  const task = await fixture.task('Owner edits');
  await fixture.commit();
  const worktree = await fixture.checkout(task);
  await fixture.accept(task, worktree);
  await writeFile(join(fixture.repo, 'README.md'), 'staged owner edit\n');
  await git(fixture.repo, ['add', 'README.md']);
  await writeFile(join(fixture.repo, 'README.md'), 'unstaged owner edit\n');
  await writeFile(join(fixture.repo, 'scratch.txt'), 'untracked owner data');
  await mkdir(join(fixture.repo, 'data'));
  await writeFile(join(fixture.repo, 'data', 'database'), 'ignored owner data');
  const staged = (await git(fixture.repo, ['diff', '--cached', '--binary', '--', 'README.md']))
    .stdout;
  const unstaged = (await git(fixture.repo, ['diff', '--binary', '--', 'README.md'])).stdout;
  await fixture.coordinator.merge(fixture.projectId, task.id);
  expect(
    (await git(fixture.repo, ['diff', '--cached', '--binary', '--', 'README.md'])).stdout,
  ).toBe(staged);
  expect((await git(fixture.repo, ['diff', '--binary', '--', 'README.md'])).stdout).toBe(unstaged);
  expect(await readFile(join(fixture.repo, 'scratch.txt'), 'utf8')).toBe('untracked owner data');
  expect(await readFile(join(fixture.repo, 'data', 'database'), 'utf8')).toBe('ignored owner data');
}, 30_000);

it('does not publish failed checks and succeeds after the owner fixes their command', async () => {
  const task = await fixture.task('Checked task');
  const context = fixture.context;
  const config = (await context.load()).config;
  await context.store.writeConfig({
    ...config,
    checks: [{ name: 'required', run: 'node -e "process.exit(7)"' }],
  });
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const before = await context.git.head();
  await expect(fixture.coordinator.merge(fixture.projectId, task.id)).rejects.toThrow();
  expect(await context.git.head()).toBe(before);
  expect((await context.store.readTask(task.id)).status).toBe('review');
  await context.store.writeConfig({
    ...config,
    checks: [{ name: 'required', run: 'node -e "process.exit(0)"' }],
  });
  context.invalidate();
  await fixture.coordinator.merge(fixture.projectId, task.id);
  expect((await context.store.readTask(task.id)).status).toBe('done');
}, 30_000);
