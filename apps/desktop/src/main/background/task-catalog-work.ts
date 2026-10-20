import { PlanCatalogQuery } from './plan-catalog-query';
import { milestoneWork } from './milestone-work';
import { AppDb } from '@skaro/core';
import type { TaskQuery, TaskRange } from '../../shared/task-catalog';
import type { PayloadStore } from './payload-store';
import { taskListWork } from './task-list-work';
import { TaskCatalogStore } from './task-catalog-store';
import { TaskCatalogQuery } from './task-catalog-query';

/** Refresh once per project revision, then answer ranges without reconstructing task arrays. */
export function taskCatalogWork(store: PayloadStore) {
  const catalog = new TaskCatalogStore(store),
    queries = new TaskCatalogQuery(catalog);
  const loaded = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();
  async function ensure(
    file: string,
    project: string,
    version: string,
    merging?: string,
  ): Promise<void> {
    const known = loaded.get(project),
      prefix = version.slice(0, version.lastIndexOf(':') + 1);
    // A newer snapshot also serves older readers; never rebuild backwards through queued requests.
    if (
      known?.startsWith(prefix) &&
      Number(known.slice(prefix.length)) >= Number(version.slice(prefix.length))
    )
      return;
    const current = pending.get(project);
    if (current) {
      await current;
      return ensure(file, project, version, merging);
    }
    const work = (async () => {
      const snapshot = await taskListWork(store, file, project, merging);
      const db = AppDb.readOnly(file);
      try {
        catalog.publish(project, snapshot, db.getSetting(`tasks.${project}.boardOrder`, {}));
      } finally {
        db.close();
      }
      loaded.delete(project);
      loaded.set(project, version);
      if (loaded.size > 32) loaded.delete(loaded.keys().next().value!);
    })();
    pending.set(project, work);
    try {
      await work;
    } finally {
      pending.delete(project);
    }
  }
  return {
    'tasks.catalog.ensure': ensure,
    'tasks.catalog.sync': async (
      file: string,
      project: string,
      version: string,
      merging?: string,
    ) => {
      await ensure(file, project, version, merging);
      return {
        revision: catalog.revision(project),
        milestones: catalog.milestones(project),
        facets: queries.facets(project),
        active: queries.range(project, { kind: 'active' }),
      };
    },
    'tasks.catalog.plan': (project: string) => new PlanCatalogQuery(catalog).groups(project),
    'tasks.catalog.relations': (project: string, id: string) =>
      new PlanCatalogQuery(catalog).relations(project, id),
    'tasks.catalog.milestone': async (root: string, id: string) =>
      (await milestoneWork(store, root, id))[0],
    'tasks.catalog.ids': (source: TaskRange) => queries.ids(source),
    'tasks.catalog.query': (project: string, query: TaskQuery) => queries.range(project, query),
    'tasks.catalog.page': (source: TaskRange, start: number) => queries.page(source, start),
    'tasks.catalog.find': (source: TaskRange, id: string) => queries.find(source, id),
    'tasks.catalog.selected': (project: string, ids: string[]) => catalog.selected(project, ids),
    'tasks.catalog.select': (source: TaskRange) =>
      catalog.selected(source.projectId, queries.ids(source), true),
    'tasks.catalog.place': (source: TaskRange, id: string, index: number) => {
      const ids = queries.ids(source).filter((value) => value !== id);
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
      return ids;
    },
  };
}
