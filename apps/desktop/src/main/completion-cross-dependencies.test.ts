import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, type Task } from '@skaro/core';
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

async function prepare(task: Task, worktree: string) {
  return prepareTaskDependencies(
    {
      deps: { db: fixture.db },
      project: () => fixture.context,
      integrations: { service: fixture.integrations },
    },
    fixture.projectId,
    task,
    await fixture.context.load(),
    worktree,
  );
}

it('integrates review results from another milestone and unstaged tasks without publishing them', async () => {
  const sourceStage = await fixture.context.store.createMilestone({ title: 'Source' });
  const targetStage = await fixture.context.store.createMilestone({ title: 'Target' });
  const sources = [
    await fixture.task('Other milestone', sourceStage.id),
    await fixture.task('No milestone'),
  ];
  const target = await fixture.task(
    'Dependent',
    targetStage.id,
    sources.map((task) => task.id),
  );
  await fixture.commit();
  const before = await fixture.context.git.head();
  for (const source of sources) await fixture.accept(source, await fixture.checkout(source));
  const worktree = await fixture.checkout(target);
  await prepare(target, worktree);
  await prepare(target, worktree); // Already present results must retain their provenance.
  for (const source of sources) {
    expect(
      (
        await git(worktree, [
          'merge-base',
          '--is-ancestor',
          fixture.journal.result(source.id)!.head,
          'HEAD',
        ])
      ).code,
    ).toBe(0);
    expect(await readFile(join(worktree, `${source.id}.txt`), 'utf8')).toBe(
      `${source.id} result\n`,
    );
    expect((await fixture.context.store.readTask(source.id)).status).toBe('review');
  }
  await fixture.accept(target, worktree);
  expect(fixture.journal.result(target.id)!.dependencies).toEqual(
    sources.map((source) => ({
      taskId: source.id,
      head: fixture.journal.result(source.id)!.head,
    })),
  );
  expect(await fixture.context.git.head()).toBe(before);
}, 30_000);

it.each(['squash', 'merge', 'rebase'] as const)(
  'requires external dependencies to be published first with %s',
  async (strategy) => {
    const stage = await fixture.context.store.createMilestone({ title: 'Dependency stage' });
    const source = await fixture.task('Source', stage.id);
    const target = await fixture.task('Dependent', undefined, [source.id]);
    const config = (await fixture.context.load()).config;
    await fixture.context.store.writeConfig({ ...config, merge: { ...config.merge, strategy } });
    await fixture.commit();
    await fixture.accept(source, await fixture.checkout(source));
    const worktree = await fixture.checkout(target);
    await prepare(target, worktree);
    await fixture.accept(target, worktree);
    const before = await fixture.context.git.head();
    await fixture.restart();
    await expect(fixture.coordinator.merge(fixture.projectId, target.id)).rejects.toThrow(
      `dependency ${source.id} must be published first`,
    );
    expect(await fixture.context.git.head()).toBe(before);
    expect((await fixture.context.store.readTask(source.id)).status).toBe('review');
    expect((await fixture.context.store.readTask(target.id)).status).toBe('review');
    await fixture.coordinator.merge(fixture.projectId, stage.id);
    await fixture.coordinator.merge(fixture.projectId, target.id);
    expect((await fixture.context.store.readTask(source.id)).status).toBe('done');
    expect((await fixture.context.store.readTask(target.id)).status).toBe('done');
    expect(await readFile(join(fixture.repo, `${target.id}.txt`), 'utf8')).toBe(
      `${target.id} result\n`,
    );
    expect(fixture.db.listMerges(fixture.projectId, source.id)).toHaveLength(1);
  },
  30_000,
);

it('does not start from missing or changed accepted dependency results', async () => {
  const source = await fixture.task('Source');
  const target = await fixture.task('Dependent', undefined, [source.id]);
  await fixture.commit();
  const a = await fixture.checkout(source);
  const b = await fixture.checkout(target);
  await fixture.context.store.updateTask(source.id, { status: 'review' });
  await fixture.context.store.updateTask(source.id, {
    body: '## Критерии приёмки\n\n- [ ] Unfinished\n',
  });
  fixture.context.invalidate();
  const before = await fixture.context.git.head('HEAD', b);
  await expect(prepare(target, b)).rejects.toThrow('no accepted result');
  await fixture.context.store.updateTask(source.id, { body: source.body });
  await fixture.accept(source, a);
  await fixture.context.store.updateTask(source.id, { status: 'in_progress' });
  fixture.context.invalidate();
  await expect(prepare(target, b)).rejects.toThrow('dependencies are not ready');
  await fixture.context.store.updateTask(source.id, { status: 'review' });
  await writeFile(join(a, 'later.txt'), 'new code\n');
  await fixture.commit(a);
  await expect(prepare(target, b)).rejects.toThrow('branch changed after submission');
  expect(await fixture.context.git.head('HEAD', b)).toBe(before);
}, 30_000);

it('retains inherited inputs and rejects a dependency resubmitted after integration', async () => {
  const first = await fixture.task('First');
  const second = await fixture.task('Second', undefined, [first.id]);
  const target = await fixture.task('Target', undefined, [second.id]);
  await fixture.commit();
  const a = await fixture.checkout(first);
  await fixture.accept(first, a);
  const b = await fixture.checkout(second);
  await prepare(second, b);
  await fixture.accept(second, b);
  const c = await fixture.checkout(target);
  await prepare(target, c);
  await fixture.accept(target, c);
  const inputs = fixture.journal.result(target.id)!.dependencies!;
  expect(inputs.map((input) => input.taskId)).toEqual([second.id, first.id]);
  await writeFile(join(a, 'revised.txt'), 'revised result\n');
  await fixture.accept(first, a);
  const blockedHead = await fixture.context.git.head('HEAD', c);
  await expect(prepare(target, c)).rejects.toThrow(
    `dependency ${first.id} changed after integration`,
  );
  expect(await fixture.context.git.head('HEAD', c)).toBe(blockedHead);
  // Before its dependency is merged the task cannot be; after that Git alone decides.
  await expect(fixture.coordinator.merge(fixture.projectId, second.id)).rejects.toThrow(
    `dependency ${first.id} must be published first`,
  );
  await fixture.coordinator.merge(fixture.projectId, first.id);
  await fixture.coordinator.merge(fixture.projectId, second.id);
  expect((await fixture.context.store.readTask(second.id)).status).toBe('done');
}, 60_000);
