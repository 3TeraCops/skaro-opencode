import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore, git } from '@skaro/core';
import { Timeline } from '@skaro/timeline';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { undoTaskMerge } from './task-merge-undo';
import { ActiveRun } from './task-run-model';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it.each(['squash', 'merge', 'rebase'] as const)(
  'undoes a %s milestone as a group and does not reclose its tasks on restart',
  async (strategy) => {
    const stage = await fixture.context.store.createMilestone({ title: 'Undo group' });
    const first = await fixture.task('First', stage.id);
    const second = await fixture.task('Second', stage.id);
    const config = (await fixture.context.load()).config;
    await fixture.context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    await fixture.commit();
    const a = await fixture.checkout(first);
    const b = await fixture.checkout(second);
    await Promise.all([fixture.accept(first, a), fixture.accept(second, b)]);
    const merged = await fixture.coordinator.merge(fixture.projectId, stage.id);
    await fixture.restart();
    const active = new ActiveRun(
      fixture.projectId,
      first.id,
      fixture.db.listRuns(fixture.projectId, first.id)[0]!,
      new Timeline(),
    );
    const hooks = {
      deps: { db: fixture.db, locale: () => 'ru', emit: () => undefined },
      active: () => [active],
      changed: () => undefined,
      skaroEvent: () => undefined,
    };
    const reverted = await undoTaskMerge(active, fixture.context, merged.commit, hooks);
    expect(await fixture.context.git.head()).toBe(reverted);
    expect(await undoTaskMerge(active, fixture.context, merged.commit, hooks)).toBe(reverted);
    for (const task of [first, second]) {
      expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
      expect(fixture.db.listMerges(fixture.projectId, task.id)[0]?.revertCommit).toBe(reverted);
      expect(existsSync(join(fixture.repo, `${task.id}.txt`))).toBe(false);
    }
    expect(await readFile(join(a, `${first.id}.txt`), 'utf8')).toBe(`${first.id} result\n`);
    expect(await readFile(join(b, `${second.id}.txt`), 'utf8')).toBe(`${second.id} result\n`);
    await fixture.restart();
    await fixture.reconcile();
    expect((await fixture.context.store.readTask(first.id)).status).toBe('review');
    expect(fixture.journal.operations()[0]?.state).toBe('reverted');
    await expect(fixture.coordinator.merge(fixture.projectId, stage.id)).rejects.toThrow(
      'reverted',
    );
  },
  30_000,
);

it('recovers a published revert before its SQLite projection was written', async () => {
  const task = await fixture.task('Revert checkpoint');
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const merged = await fixture.coordinator.merge(fixture.projectId, task.id);
  const operation = fixture.journal.operations()[0]!;
  const reverted = await fixture.context.git.revert(merged.commit, 'Revert checkpoint', {
    managedPaths: [task.path],
    beforeCommit: async (checkout) => {
      await new ArtifactStore(checkout).updateTask(task.id, { status: 'review' });
      return [task.path];
    },
    prepared: async (candidate) => {
      operation.revertCandidate = candidate;
      fixture.journal.save(operation);
      await git(fixture.repo, [
        'update-ref',
        `refs/skaro/completions/${operation.id}-revert`,
        candidate.commit,
      ]);
    },
  });
  expect(reverted.ok).toBe(true);
  expect(fixture.db.listMerges(fixture.projectId, task.id)[0]?.revertCommit).toBeUndefined();
  await fixture.restart();
  await fixture.reconcile();
  expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
  expect(fixture.journal.operations()[0]?.state).toBe('reverted');
  expect(fixture.db.listMerges(fixture.projectId, task.id)[0]?.revertCommit).toBe(
    fixture.journal.operations()[0]?.revertCandidate?.commit,
  );
}, 30_000);

it('keeps later owner work and completed state if reversal conflicts', async () => {
  const task = await fixture.task('Conflicting reversal');
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const merged = await fixture.coordinator.merge(fixture.projectId, task.id);
  await writeFile(join(fixture.repo, `${task.id}.txt`), 'later owner work\n');
  await fixture.commit(fixture.repo, 'owner revision');
  const before = await fixture.context.git.head();
  const active = new ActiveRun(
    fixture.projectId,
    task.id,
    fixture.db.listRuns(fixture.projectId, task.id)[0]!,
    new Timeline(),
  );
  await expect(
    undoTaskMerge(active, fixture.context, merged.commit, {
      deps: { db: fixture.db, locale: () => 'ru', emit: () => undefined },
      active: () => [active],
      changed: () => undefined,
      skaroEvent: () => undefined,
    }),
  ).rejects.toThrow('Revert conflicts');
  expect(await fixture.context.git.head()).toBe(before);
  expect((await fixture.context.store.readTask(task.id)).status).toBe('done');
  expect(await readFile(join(fixture.repo, `${task.id}.txt`), 'utf8')).toBe('later owner work\n');
  expect(fixture.db.listMerges(fixture.projectId, task.id)[0]?.revertCommit).toBeUndefined();
}, 30_000);
