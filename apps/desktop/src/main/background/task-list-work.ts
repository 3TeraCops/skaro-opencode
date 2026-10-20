import { projectStages } from '../stage-views';
import { AppDb } from '@skaro/core';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { taskListSnapshot } from '../task-list-reader';
import { IntegrationStore } from '../integration-store';
import { projectMetadata } from './project-metadata';
import type { PayloadStore } from './payload-store';
/** Only derived card metadata leaves this worker; filesystem work is bounded in batches. */
export async function taskListWork(
  store: PayloadStore,
  file: string,
  projectId: string,
  merging?: string,
) {
  const db = AppDb.readOnly(file);
  try {
    const project = db.shell.get(projectId);
    if (!project) throw new Error('Unknown project');
    const artifacts = await projectMetadata(store, db, project.path);
    const mtimes = new Map<string, number>();
    for (let at = 0; at < artifacts.tasks.length; at += 16)
      await Promise.all(
        artifacts.tasks.slice(at, at + 16).map(async (task) => {
          const info = await stat(join(project.path, task.path)).catch(() => undefined);
          mtimes.set(task.id, info?.mtimeMs ?? 0);
        }),
      );
    return taskListSnapshot(
      db,
      projectId,
      artifacts,
      mtimes,
      new IntegrationStore(db, store.dataDir).all(projectId),
      merging,
    );
  } finally {
    db.close();
  }
}

export async function stageListWork(store: PayloadStore, file: string, projectId: string) {
  const db = AppDb.readOnly(file);
  try {
    const project = db.shell.get(projectId);
    if (!project) throw new Error('Unknown project');
    const artifacts = await projectMetadata(store, db, project.path);
    return projectStages(artifacts, db.getTaskRuntime(projectId), {
      awaiting: new Set(Object.keys(db.getSetting(`tasks.${projectId}.awaitingStart`, {}) ?? {})),
      integrations: new IntegrationStore(db, store.dataDir).all(projectId),
    });
  } finally {
    db.close();
  }
}
