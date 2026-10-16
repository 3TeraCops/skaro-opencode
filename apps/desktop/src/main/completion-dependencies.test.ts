import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { prepareTaskDependencies } from './task-dependency-checkout';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

const context = () => ({
  deps: { db: fixture.db },
  project: () => fixture.context,
  integrations: { service: fixture.integrations },
});

it('materializes exact accepted review dependencies before dependent work begins', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Dependencies' });
  const source = await fixture.task('Source', stage.id);
  const target = await fixture.task('Target', stage.id, [source.id]);
  await fixture.commit();
  const before = await fixture.context.git.head();
  const a = await fixture.checkout(source);
  const b = await fixture.checkout(target);
  await fixture.accept(source, a);
  const saved = fixture.journal.result(source.id)!;
  await prepareTaskDependencies(
    context(),
    fixture.projectId,
    target,
    await fixture.context.load(),
    b,
  );
  expect((await git(b, ['merge-base', '--is-ancestor', saved.head, 'HEAD'])).code).toBe(0);
  expect(await readFile(join(b, `${source.id}.txt`), 'utf8')).toBe(`${source.id} result\n`);
  expect(await fixture.context.git.head()).toBe(before);
  expect(
    fixture.db.getSetting(`completion.${fixture.projectId}.dependencies.${target.id}`, []),
  ).toEqual([saved]);
  await fixture.accept(target, b);
  await fixture.coordinator.merge(fixture.projectId, stage.id);
  expect((await fixture.context.store.readTask(source.id)).status).toBe('done');
  expect((await fixture.context.store.readTask(target.id)).status).toBe('done');
}, 30_000);

it('continues over unfinished work when the accepted dependencies are already in the checkout', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Agent change' });
  const source = await fixture.task('Source', stage.id);
  const target = await fixture.task('Target', stage.id, [source.id]);
  await fixture.commit();
  const a = await fixture.checkout(source);
  const b = await fixture.checkout(target);
  await fixture.accept(source, a);
  const prepare = async () =>
    prepareTaskDependencies(context(), fixture.projectId, target, await fixture.context.load(), b);
  await prepare();
  const head = await fixture.context.git.head('HEAD', b);
  await writeFile(join(b, 'draft.txt'), 'unfinished agent work\n');
  await prepare();
  expect(await fixture.context.git.head('HEAD', b)).toBe(head);
  expect(await readFile(join(b, 'draft.txt'), 'utf8')).toBe('unfinished agent work\n');
}, 30_000);

it('preserves dependent checkout edits and retains conflicts in the isolated integration', async () => {
  const stage = await fixture.context.store.createMilestone({ title: 'Dependency safety' });
  const source = await fixture.task('Source', stage.id);
  const target = await fixture.task('Target', stage.id, [source.id]);
  await fixture.commit();
  const a = await fixture.checkout(source);
  const b = await fixture.checkout(target);
  await fixture.accept(source, a, 'shared.txt');
  await writeFile(join(b, 'shared.txt'), 'unfinished owner edit\n');
  const prepare = () =>
    fixture.context
      .load()
      .then((artifacts) =>
        prepareTaskDependencies(context(), fixture.projectId, target, artifacts, b),
      );
  await expect(prepare()).rejects.toThrow('preserve uncommitted changes');
  expect(await readFile(join(b, 'shared.txt'), 'utf8')).toBe('unfinished owner edit\n');
  await fixture.commit(b, 'different existing work');
  const before = await fixture.context.git.head('HEAD', b);
  await expect(prepare()).rejects.toThrow('Skaro is resolving integration');
  expect(await fixture.context.git.head('HEAD', b)).toBe(before);
  expect((await git(b, ['status', '--porcelain'])).stdout.trim()).toBe('');
  expect(await readFile(join(b, 'shared.txt'), 'utf8')).toBe('unfinished owner edit\n');
}, 30_000);
