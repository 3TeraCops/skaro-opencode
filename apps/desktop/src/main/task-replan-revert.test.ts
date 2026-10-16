import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { replanWorkspace } from './task-replan-test-workspace';
import { TaskReplanJournal } from './task-replan-journal';
import { beginReplanRevert } from './task-replan-revert';
import { taskFiles } from './task-replan-files';
import { taskReplanLockKey, serializeTaskMutation } from './project-task-mutations';
import { settingsKey } from './task-run-helpers';

it('reports the actual result after the old reply and restores exact files, identities and edges once', async () => {
  const w = await replanWorkspace();
  try {
    const path = join(w.store.root, w.a.path);
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(
        'status: todo',
        'status: todo\nowner_tag: keep-this # custom metadata',
      ),
    );
    const before = (await w.store.load()).tasks;
    const files = await taskFiles(w.store.root, before);
    const item = await w.offer();
    w.engine.history.skaroEvent(w.live, {
      t: 'item.upsert',
      item: {
        id: 'old-reply',
        kind: 'message',
        role: 'agent',
        phase: 'final',
        text: 'Пока план не принят, задачи не изменены.',
        turnId: '',
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'message', ref: '' },
      },
    });
    await w.apply(item);
    const applied = w.engine.proposals.proposals(w.live)[0]!;
    expect(applied.result?.replan).toMatchObject({
      writes: 2,
      totalWrites: 2,
      removes: 1,
      totalRemoves: 1,
    });
    const resultId = `skaro-replan-${item.id}-applied`;
    const index = w.live.timeline.state.items.findIndex((i) => i.id === resultId);
    expect(index).toBeGreaterThan(
      w.live.timeline.state.items.findIndex((i) => i.id === 'old-reply'),
    );
    expect(w.live.timeline.state.items[index]).toMatchObject({
      kind: 'notice',
      text: 'Перепланирование завершено. Задачи: 2 → 1.',
    });
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, {
      action: 'revert',
    });
    expect((await w.store.load()).tasks).toEqual(before);
    expect(await taskFiles(w.store.root, before)).toEqual(files);
    expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('reverted');
    await w.engine.replans.recover(w.live);
    await w.engine.replans.recover(w.live);
    expect(w.live.timeline.state.items.filter((i) => i.id === resultId)).toHaveLength(1);
    expect(
      w.live.timeline.state.items.filter((i) => i.id === `skaro-replan-${item.id}-reverted`),
    ).toHaveLength(1);
    expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBeNull();
  } finally {
    await w.close();
  }
});

it('rejects a changed file, new incoming dependency, queued dependent and started history before undo writes', async () => {
  const w = await replanWorkspace();
  try {
    const item = await w.offer();
    await w.apply(item);
    const undo = () =>
      w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, { action: 'revert' });
    const path = join(w.store.root, w.a.path);
    const original = await readFile(path, 'utf8');
    const duplicate = join(w.store.root, '.skaro/tasks/duplicate.md');
    await writeFile(duplicate, original);
    await expect(undo()).rejects.toThrow('Duplicate task identities');
    expect(await readFile(path, 'utf8')).toBe(original);
    await unlink(duplicate);
    const edited = original.replace('status: todo', 'status: todo\nowner_tag: added-after-apply');
    await writeFile(path, edited);
    await expect(undo()).rejects.toThrow('file changed');
    expect(await readFile(path, 'utf8')).toBe(edited);
    await writeFile(path, original);
    const added = await w.store.createTask({ title: 'New dependent', dependsOn: [w.a.id] });
    await expect(undo()).rejects.toThrow('new dependency');
    await w.store.updateTask(added.id, { dependsOn: [] });
    w.db.setTaskRuntime(w.live.projectId, w.c.id, 'queued');
    await expect(undo()).rejects.toThrow('not queued');
    w.db.setTaskRuntime(w.live.projectId, w.c.id, 'idle');
    w.db.createRun({
      projectId: w.live.projectId,
      taskId: w.a.id,
      agent: 'codex',
      adapterVersion: 'verification',
      logPath: 'record-only.jsonl',
    });
    await expect(undo()).rejects.toThrow('never started');
    expect(new TaskReplanJournal(w.db, w.live.projectId).list()[0]!.phase).toBe('applied');
    expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBeNull();
    expect(await readFile(path, 'utf8')).toBe(original);
    expect((await w.store.load()).tasks.map((t) => t.id)).toEqual([w.a.id, w.c.id, added.id]);
  } finally {
    await w.close();
  }
});

it('recovers a partially written split reversal, preserves foreign edits and never reuses removed IDs', async () => {
  const w = await replanWorkspace();
  try {
    const before = (await w.store.load()).tasks;
    const preferences = { agent: 'codex', effort: 'high', followProject: false };
    w.db.setSetting(settingsKey(w.live.projectId, w.a.id), preferences);
    const item = await w.offer({
      ...w.args,
      key: 'split-undo',
      taskIds: [w.a.id],
      tasks: [
        {
          ...w.args.tasks[0]!,
          sources: [w.a.id],
          criteria: ['Запрос обрабатывается.'],
          ref: 'first',
        },
        {
          ...w.args.tasks[0]!,
          sources: [w.a.id],
          criteria: ['Результат доступен.'],
          ref: 'second',
          id: undefined,
          title: 'Second',
          dependsOn: ['first'],
        },
      ],
    });
    await w.apply(item);
    const journal = new TaskReplanJournal(w.db, w.live.projectId);
    const decision = journal.list()[0]!;
    await serializeTaskMutation(
      w.engine.project(w.live.projectId),
      () => beginReplanRevert(w.engine, decision),
      true,
    );
    const first = decision.revert!.originals[0]!;
    await w.store.restoreReplannedTask(first.task, first.before, first.after);
    const created = decision.revert!.created[0]!;
    const path = join(w.store.root, created.task.path);
    await writeFile(path, `${created.content}\nManual change during recovery\n`);
    await w.engine.replans.recoverAll();
    expect(journal.list()[0]!.phase).toBe('reverting');
    expect(journal.list()[0]!.error).toContain('changed during reverting');
    expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBe(item.id);
    await writeFile(path, created.content);
    await w.engine.replans.recoverAll();
    expect((await w.store.load()).tasks).toEqual(before);
    expect(journal.list()[0]!.phase).toBe('reverted');
    expect(w.db.getSetting(settingsKey(w.live.projectId, w.a.id), null)).toEqual(preferences);
    expect(w.db.getSetting(settingsKey(w.live.projectId, created.task.id), null)).toBeNull();
    expect(Number((await w.store.createTask({ title: 'Later task' })).id.slice(2))).toBeGreaterThan(
      Number(created.task.id.slice(2)),
    );
  } finally {
    await w.close();
  }
});

it('restores a legacy applied journal and preserves unrelated subsequent work', async () => {
  const w = await replanWorkspace();
  try {
    const before = (await w.store.load()).tasks;
    const item = await w.offer();
    await w.apply(item);
    const journal = new TaskReplanJournal(w.db, w.live.projectId);
    const legacy = journal.list()[0]!;
    delete legacy.beforeFiles;
    delete legacy.afterFiles;
    journal.save(legacy);
    const unrelated = await w.store.createTask({ title: 'Independent new work' });
    await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, {
      action: 'revert',
    });
    expect((await w.store.load()).tasks).toEqual([...before, unrelated]);
  } finally {
    await w.close();
  }
});
