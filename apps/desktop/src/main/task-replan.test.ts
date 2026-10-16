import { replanWorkspace as workspace } from './task-replan-test-workspace';
import { parseTaskReplan, replanTasksTool, type ReplanTasksArgs } from '@skaro/mcp-server';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';
import { allocateReplan } from './task-replan-apply';
import { serializeTaskMutation, taskReplanLockKey } from './project-task-mutations';

import { settingsKey } from './task-run-helpers';

describe('task graph replanning', () => {
  it('applies one confirmed merge with retained identity, criteria and incoming dependencies', async () => {
    const w = await workspace();
    try {
      const before = (await w.store.load()).tasks;
      const item = await w.offer();
      expect((await w.store.load()).tasks).toEqual(before);
      await w.offer();
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
      expect(item.proposal.type).toBe('task_replan');
      await w.apply(item);
      const tasks = (await w.store.load()).tasks;
      expect(tasks.map((t) => t.id)).toEqual([w.a.id, w.c.id]);
      expect(tasks[0]).toMatchObject({ milestone: 'M02', order: 3, spec: '0001', dependsOn: [] });
      expect(tasks[0]!.body).toContain('Запрос документирован.');
      expect(tasks[1]!.dependsOn).toEqual([w.a.id]);
      expect(new TaskReplanJournal(w.db, w.live.projectId).list()[0]!.phase).toBe('applied');
      expect(existsSync(join(w.root, 'worktrees'))).toBe(false);
      await w.apply(item);
      expect((await w.store.load()).tasks).toEqual(tasks);
    } finally {
      await w.close();
    }
  });

  it('splits a source, rewires dependents to both outputs and preserves task preferences', async () => {
    const w = await workspace();
    try {
      w.db.setSetting(settingsKey(w.live.projectId, w.a.id), {
        agent: 'codex',
        effort: 'high',
        followProject: false,
      });
      const args: ReplanTasksArgs = {
        key: 'split',
        title: 'Разделить обработку',
        taskIds: [w.a.id],
        tasks: [
          {
            ...w.args.tasks[0]!,
            id: w.a.id,
            ref: 'first',
            sources: [w.a.id],
            criteria: ['Запрос обрабатывается.'],
            order: 1,
          },
          {
            ...w.args.tasks[0]!,
            id: undefined,
            ref: 'second',
            sources: [w.a.id],
            title: 'Завершить обработку',
            criteria: ['Результат обработки доступен.'],
            dependsOn: ['first'],
            milestone: undefined,
            order: 2,
          },
        ],
      };
      await w.apply(await w.offer(args));
      const tasks = (await w.store.load()).tasks;
      const second = tasks.find((t) => t.title === 'Завершить обработку')!;
      expect(second.id).not.toBe(w.a.id);
      expect(second.milestone).toBeUndefined();
      expect(second.dependsOn).toEqual([w.a.id]);
      expect(tasks.find((t) => t.id === w.b.id)!.dependsOn).toEqual([w.a.id, second.id]);
      expect(w.db.getSetting(settingsKey(w.live.projectId, second.id), null)).toEqual(
        w.db.getSetting(settingsKey(w.live.projectId, w.a.id), null),
      );
    } finally {
      await w.close();
    }
  });

  it('rejects the whole stale proposal before any task is changed', async () => {
    const w = await workspace();
    try {
      const item = await w.offer();
      await w.store.updateTask(w.b.id, { title: 'Изменено владельцем' });
      const before = (await w.store.load()).tasks;
      await expect(w.apply(item)).rejects.toThrow('changed after this proposal');
      expect((await w.store.load()).tasks).toEqual(before);
      expect(new TaskReplanJournal(w.db, w.live.projectId).list()).toEqual([]);
    } finally {
      await w.close();
    }
  });

  it('refuses a task returned to todo and an external dependent queued after the proposal', async () => {
    const w = await workspace();
    try {
      const item = await w.offer();
      w.db.setTaskRuntime(w.live.projectId, w.c.id, 'queued');
      await expect(w.apply(item)).rejects.toThrow('not queued or scheduled');
      w.db.setTaskRuntime(w.live.projectId, w.c.id, 'idle');
      w.db.createRun({
        projectId: w.live.projectId,
        taskId: w.a.id,
        agent: 'codex',
        adapterVersion: 'test',
        logPath: 'never-launched.jsonl',
      });
      await expect(w.apply(item)).rejects.toThrow('never started');
      expect((await w.store.load()).tasks).toHaveLength(3);
    } finally {
      await w.close();
    }
  });

  it('refuses dropped criteria, missing sources and cycles', async () => {
    const w = await workspace();
    try {
      await expect(
        w.offer({
          ...w.args,
          tasks: [{ ...w.args.tasks[0]!, criteria: ['Запрос обрабатывается.'] }],
        }),
      ).rejects.toThrow('source acceptance criteria must be preserved');
      await expect(
        w.offer({ ...w.args, tasks: [{ ...w.args.tasks[0]!, sources: [w.a.id] }] }),
      ).rejects.toThrow('every source must have a replacement');
      await expect(
        w.offer({ ...w.args, tasks: [{ ...w.args.tasks[0]!, dependsOn: [w.c.id] }] }),
      ).rejects.toThrow('cycle');
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(0);
    } finally {
      await w.close();
    }
  });

  it('rejecting the single package preserves all tasks', async () => {
    const w = await workspace();
    try {
      const before = (await w.store.load()).tasks;
      const item = await w.offer();
      await w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, {
        action: 'reject',
      });
      expect((await w.store.load()).tasks).toEqual(before);
      expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('rejected');
    } finally {
      await w.close();
    }
  });

  it('recovers a partially written merge and releases the durable launch lock', async () => {
    const w = await workspace();
    try {
      const item = await w.offer();
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
      const first = decision.writes[0]!;
      await w.store.updateTaskAtomically(first.id, first.input);
      await expect(
        serializeTaskMutation(w.engine.project(w.live.projectId), async () => undefined),
      ).rejects.toThrow('recovering');
      await w.engine.replans.recoverAll();
      const after = (await w.store.load()).tasks;
      expect(after.map((t) => t.id)).toEqual([w.a.id, w.c.id]);
      expect(after[1]!.dependsOn).toEqual([w.a.id]);
      expect(w.db.getSetting(taskReplanLockKey(w.live.projectId), null)).toBeNull();
      await w.engine.replans.recoverAll();
      expect((await w.store.load()).tasks).toEqual(after);
    } finally {
      await w.close();
    }
  });

  it('parses the wire contract and denies task/import sessions before calling project handlers', async () => {
    const w = await workspace();
    try {
      const raw = {
        key: 'wire',
        title: w.args.title,
        task_ids: w.args.taskIds,
        tasks: w.args.tasks.map((t) => ({ ...t, depends_on: t.dependsOn })),
      };
      expect(parseTaskReplan(raw).taskIds).toEqual(w.args.taskIds);
      const tool = replanTasksTool((args, scope) => w.engine.replans.tool(args, scope));
      expect(
        tool.available?.({
          kind: 'project_chat',
          projectId: w.live.projectId,
          chatId: w.live.chat.id,
        }),
      ).toBe(true);
      expect(
        tool.available?.({
          kind: 'project_chat',
          projectId: w.live.projectId,
          chatId: w.live.chat.id,
          importId: 'i',
        }),
      ).toBe(false);
      expect(
        (
          await tool.call(raw, {
            kind: 'task',
            projectId: w.live.projectId,
            taskId: w.a.id,
            runId: 'r',
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await tool.call(
            { ...raw, tasks: [{ ...raw.tasks[0]!, order: -1 }] },
            { kind: 'project_chat', projectId: w.live.projectId, chatId: w.live.chat.id },
          )
        ).isError,
      ).toBe(true);
    } finally {
      await w.close();
    }
  });
});
