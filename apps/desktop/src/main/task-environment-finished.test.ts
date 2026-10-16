import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { AppDb, type ArtifactStore } from '@skaro/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationStore } from './integration-store';
import { Projects } from './projects';
import { taskEnvironmentFinished } from './task-environment-finished';

// Authorized isolated records use the real artifact store and SQLite; no Docker or service doubles.
let directory: string;
let root: string;
let db: AppDb;
let projects: Projects;
let integrations: IntegrationStore;
let projectId: string;
let store: ArtifactStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'skaro-environment-finished-'));
  root = join(directory, 'project');
  await mkdir(root);
  db = AppDb.open(join(directory, 'app.sqlite'));
  projectId = db.addProject({ name: 'Environment lifecycle check', path: root }).id;
  projects = new Projects(db, () => undefined);
  integrations = new IntegrationStore(db, directory);
  store = projects.get(projectId).store;
});

afterEach(async () => {
  projects?.close();
  db?.close();
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-environment-finished-')
  )
    throw new Error('Refusing to remove a directory outside this isolated check');
  await rm(directory, { recursive: true, force: true });
});

const finished = (taskId: string) =>
  taskEnvironmentFinished({ db, projects, integrations }, { projectId, taskId });

describe('environment completion from real project artifacts', () => {
  it('retains review data and reads terminal status freshly despite a cached project view', async () => {
    const task = await store.createTask({ title: 'Review lifecycle' });
    await store.updateTask(task.id, { status: 'review' });
    await projects.get(projectId).load();
    expect(await finished(task.id)).toBe(false);
    await store.updateTask(task.id, { status: 'done' });
    expect(await finished(task.id)).toBe(true);
    await store.updateTask(task.id, { status: 'cancelled' });
    expect(await finished(task.id)).toBe(true);
  });

  it('retains data when task metadata is malformed or its directory disappears', async () => {
    const task = await store.createTask({ title: 'Unreadable task' });
    await store.updateTask(task.id, { status: 'review' });
    await writeFile(join(root, task.path), '---\nid: [\n---\n');
    expect(await finished(task.id)).toBe(false);
    await rename(join(root, '.skaro', 'tasks'), join(root, '.skaro', 'tasks-unavailable'));
    expect(await finished(task.id)).toBe(false);
  });

  it('recognizes a deleted task only while the remaining task directory can be read', async () => {
    const removed = await store.createTask({ title: 'Explicitly removed task' });
    const retained = await store.createTask({ title: 'Retained review task' });
    await store.updateTask(retained.id, { status: 'review' });
    await store.deleteTask(removed.id);
    expect(await finished(removed.id)).toBe(true);
    expect(await finished(retained.id)).toBe(false);
  });

  it('keeps a legacy shared environment for archived unfinished work and malformed milestones', async () => {
    const milestone = await store.createMilestone({ title: 'Shared legacy checkout' });
    const task = await store.createTask({ title: 'Archived review', milestone: milestone.id });
    await store.updateTask(task.id, { status: 'review', archived: true });
    expect(await finished(milestone.id)).toBe(false);
    await store.updateTask(task.id, { status: 'done' });
    expect(await finished(milestone.id)).toBe(true);
    await writeFile(join(root, milestone.path), '---\nid: [\n---\n');
    expect(await finished(milestone.id)).toBe(false);
  });

  it('does not treat removing a project from the list as permission to destroy its data', async () => {
    const task = await store.createTask({ title: 'Unregistered project' });
    await store.updateTask(task.id, { status: 'done' });
    expect(await finished(task.id)).toBe(true);
    db.removeProject(projectId);
    expect(await finished(task.id)).toBe(false);
  });
});
