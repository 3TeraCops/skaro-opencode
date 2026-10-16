import { AppDb, ArtifactStore } from '@skaro/core';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

declare const window: Window & { skaro: SkaroApi };

test.skip(noAgents, noAgentsReason);

async function setup(reused: boolean) {
  const userData = tempUserData();
  const root = join(userData, 'project');
  mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, windowsHide: true });
  const store = new ArtifactStore(root);
  const task = await store.createTask({ title: 'Подготовить спецификации' });
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Task identity regression', path: root });
  db.setOpenTabs([project.id], project.id);
  const run = db.createRun({
    projectId: project.id,
    taskId: task.id,
    agent: 'codex',
    adapterVersion: 'saved',
    logPath: 'runs/old.jsonl',
  });
  db.setRunSession(run.id, 'old-native-session');
  mkdirSync(join(userData, 'runs'));
  writeFileSync(join(userData, run.logPath), '');
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Implementation plan',
    logPath: 'chats/plan.jsonl',
  });
  mkdirSync(join(userData, 'chats'));
  writeFileSync(
    join(userData, chat.logPath),
    JSON.stringify({
      ts: 0,
      dir: 'meta',
      line: {
        skaro: 'event',
        event: {
          t: 'item.upsert',
          item: {
            id: 'new-task',
            kind: 'proposal',
            turnId: '',
            state: 'pending',
            status: 'done',
            startedAt: Date.now(),
            native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
            proposal: {
              type: 'plan',
              tasks: [
                {
                  ref: 'fix',
                  title: 'Исправить хранение черновика',
                  body: '## Цель\n\nИсправить хранение.',
                  dependsOn: [],
                  dependsOnTitles: [],
                },
              ],
            },
          },
        },
      },
    }) + '\n',
  );
  if (reused) {
    // Reproduce the legacy collision using real persistence, with no running fake agent.
    db.retireTaskRuns(project.id, task.id);
    await store.updateTask(task.id, { title: 'Бэкенд: Хранение черновика', status: 'in_progress' });
  }
  db.close();
  return {
    userData,
    root,
    store,
    projectId: project.id,
    taskId: task.id,
    runId: run.id,
    chatId: chat.id,
  };
}

test('deletion retires the native session and a new proposal gets a different task number', async () => {
  const fixture = await setup(false);
  const ids = { projectId: fixture.projectId, taskId: fixture.taskId, chatId: fixture.chatId };
  const app = await launchApp(fixture.userData);
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.skaro);
    await page.evaluate(
      ({ projectId, taskId }) => window.skaro.invoke('tasks.delete', projectId, [taskId]),
      ids,
    );
    const db = AppDb.open(join(fixture.userData, 'skaro.db'));
    try {
      expect(db.listRuns(fixture.projectId, fixture.taskId)).toEqual([]);
      expect(db.getRun(fixture.runId)).toMatchObject({
        retiredAt: expect.any(Number),
        nativeSessionId: 'old-native-session',
      });
    } finally {
      db.close();
    }
    await page.evaluate(
      ({ projectId, chatId }) =>
        window.skaro.invoke('chat.proposal', projectId, chatId, 'new-task', { action: 'apply' }),
      ids,
    );
    const artifacts = await fixture.store.load();
    expect(artifacts.tasks.map((task) => task.id)).toEqual(['T-002']);
    const opened = await page.evaluate(
      ({ projectId }) => window.skaro.invoke('task.open', projectId, 'T-002'),
      ids,
    );
    expect(opened.run).toBeUndefined();
    expect(opened.task.title).toBe('Исправить хранение черновика');
  } finally {
    await app.close();
  }
});

test('opening a legacy reused number removes the stale in-progress state and old session', async () => {
  const fixture = await setup(true);
  const ids = { projectId: fixture.projectId, taskId: fixture.taskId };
  const app = await launchApp(fixture.userData);
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.skaro);
    const opened = await page.evaluate(
      ({ projectId, taskId }) => window.skaro.invoke('task.open', projectId, taskId),
      ids,
    );
    expect(opened.run).toBeUndefined();
    expect(opened.timeline).toBeUndefined();
    expect(opened.task.stage).toBe('todo');
    expect(opened.task.title).toBe('Бэкенд: Хранение черновика');
    expect((await fixture.store.readTask(fixture.taskId)).status).toBe('todo');
  } finally {
    await app.close();
  }
});
