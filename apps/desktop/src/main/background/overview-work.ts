import { join } from 'node:path';
import { AppDb, GitService } from '@skaro/core';
import { projectMetadata } from './project-metadata';
import type { PayloadStore } from './payload-store';
import { projectCardFrom } from '../overview';
import { logoReference } from '../project-logo-reference';

/** Task graph summaries and Git reads cannot occupy the registry pager or main process. */
export async function overviewWork(store: PayloadStore, projectId: string) {
  const db = AppDb.readOnly(join(store.dataDir, 'skaro.db'));
  try {
    const project = db.shell.get(projectId);
    if (!project) throw new Error('Unknown project');
    const git = new GitService(project.path);
    return await projectCardFrom(
      db,
      { ...project, logo: logoReference(project) },
      {
        summary: () => projectMetadata(store, db, project.path),
        branch: () => git.currentBranch(),
      },
    );
  } finally {
    db.close();
  }
}
