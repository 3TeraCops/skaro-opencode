import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './store.ts';
import { AppDb } from '../db/appdb.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-task-identity-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('permanent task numbers', () => {
  it('does not reuse deleted highest numbers after reopening the store', async () => {
    const store = new ArtifactStore(root);
    const first = await store.createTask({ title: 'Первая' });
    const highest = await store.createTask({ title: 'Прежнее назначение' });
    await store.deleteTask(highest.id);
    const reopened = new ArtifactStore(root);
    expect((await reopened.createTask({ title: 'Новое назначение' })).id).toBe('T-003');
    await reopened.deleteTask(first.id);
    await reopened.deleteTask('T-003');
    expect((await new ArtifactStore(root).createTask({ title: 'После удаления всех' })).id).toBe(
      'T-004',
    );
  });

  it('allocates distinct numbers to concurrent store instances', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        new ArtifactStore(root).createTask({ title: `Задача ${i + 1}` }),
      ),
    );
    expect(new Set(created.map((task) => task.id)).size).toBe(8);
    expect((await new ArtifactStore(root).load()).tasks).toHaveLength(8);
  });

  it('reserves numbers known only from legacy runs and deletion events', async () => {
    const db = AppDb.open(':memory:');
    try {
      const project = db.addProject({ name: 'Legacy', path: root });
      db.createRun({
        projectId: project.id,
        taskId: 'T-050',
        agent: 'codex',
        logPath: 'old.jsonl',
        adapterVersion: 'test',
      });
      db.addEvent(project.id, 'task_deleted', { task: 'T-061' });
      const store = new ArtifactStore(
        root,
        () => ({}),
        () => db.usedTaskIds(project.id),
      );
      expect((await store.createTask({ title: 'Новая серверная задача' })).id).toBe('T-062');
    } finally {
      db.close();
    }
  });
});
