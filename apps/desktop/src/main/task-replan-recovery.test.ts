import { git, taskBranch } from '@skaro/core';
import { expect, it } from 'vitest';
import { replanWorkspace } from './task-replan-test-workspace';
import { allocateReplan } from './task-replan-apply';
import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';
import { taskReplanLockKey } from './project-task-mutations';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

it('recognizes an already created split output, protects foreign edits and recovers without duplicates', async () => {
  const w = await replanWorkspace();
  try {
    const item = await w.offer({
      ...w.args,
      key: 'split-recovery',
      taskIds: [w.a.id],
      tasks: [
        {
          ...w.args.tasks[0]!,
          id: w.a.id,
          ref: 'first',
          sources: [w.a.id],
          criteria: ['Запрос обрабатывается.'],
        },
        {
          ...w.args.tasks[0]!,
          id: undefined,
          ref: 'second',
          sources: [w.a.id],
          criteria: ['Результат доступен.'],
          dependsOn: ['first'],
        },
      ],
    });
    const decision: TaskReplanDecision = {
      projectId: w.live.projectId,
      chatId: w.live.chat.id,
      item,
      phase: 'allocating',
      ids: {},
      before: (await w.store.load()).tasks,
      writes: [],
      removes: [],
    };
    const journal = new TaskReplanJournal(w.db, w.live.projectId);
    journal.save(decision);
    w.db.setSetting(taskReplanLockKey(w.live.projectId), item.id);
    await allocateReplan(w.engine, decision);
    const created = decision.writes.find((write) => !write.before)!;
    const createdTask = await w.store.createReservedTask(created.id, created.input);
    const createdPath = join(w.store.root, createdTask.path);
    const originalFile = await readFile(createdPath, 'utf8');
    const corruptFile = '---\nid: [unterminated\n---\n';
    await writeFile(createdPath, corruptFile);
    await w.engine.replans.recoverAll();
    expect(journal.list()[0]!.error).toContain('unreadable artifact');
    expect(await readFile(createdPath, 'utf8')).toBe(corruptFile);
    await writeFile(createdPath, originalFile);
    // An actual manual edit during a crash must not be mistaken for part of the package.
    await w.store.updateTask(w.c.id, { title: 'Изменено вручную' });
    await w.engine.replans.recoverAll();
    expect((await w.store.readTask(w.c.id)).title).toBe('Изменено вручную');
    expect(journal.list()[0]!.error).toContain('changed during replanning');
    expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBe(item.id);
    await w.store.updateTask(w.c.id, { title: w.c.title });
    await w.engine.replans.recoverAll();
    const after = (await w.store.load()).tasks;
    expect(after).toHaveLength(4);
    expect(after.find((t) => t.id === w.b.id)!.dependsOn).toEqual([w.a.id, created.id]);
    expect(journal.list()[0]!.phase).toBe('applied');
    // A crash after saving 'applied' but before clearing the launch lock also recovers.
    w.db.setSetting(taskReplanLockKey(w.live.projectId), item.id);
    await w.engine.replans.recoverAll();
    expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBeNull();
    expect((await w.store.load()).tasks).toEqual(after);
  } finally {
    await w.close();
  }
});

it('refuses an orphan task branch left before a run record was created', async () => {
  const w = await replanWorkspace();
  try {
    await git(w.store.root, [
      '-c',
      'user.name=Skaro verification',
      '-c',
      'user.email=verification@localhost',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      ':white_check_mark: test: initialize isolated verification',
    ]);
    await git(w.store.root, ['branch', taskBranch((await w.store.load()).config, w.a)]);
    await expect(w.offer()).rejects.toThrow('existing task branch');
    expect((await w.store.load()).tasks).toHaveLength(3);
  } finally {
    await w.close();
  }
});
