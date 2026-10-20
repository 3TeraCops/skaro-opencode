import type { PlanCatalog, PlanStage, TaskLink } from '../../shared/plan-catalog';
import type { TaskCatalogStore } from './task-catalog-store';

/** Graph facts stay indexed in SQLite; the renderer receives groups and visible-row links. */
export class PlanCatalogQuery {
  private readonly catalog: TaskCatalogStore;
  constructor(catalog: TaskCatalogStore) {
    this.catalog = catalog;
  }
  groups(project: string): PlanCatalog {
    const rows = this.catalog.store.db
      .prepare(
        `SELECT milestone,archived,count(*) AS count,
      sum(status='done') AS done,sum(status!='cancelled') AS total,
      sum(status IN ('in_progress','queued')) AS working,
      sum(status IN ('needs_answer','review')) AS attention,sum(status='failed') AS errors,
      sum(json_extract(value,'$.stage')!='todo' OR status NOT IN ('todo','blocked')) AS started
      FROM task_catalog WHERE project=? GROUP BY milestone,archived`,
      )
      .all(project);
    const byMilestone = new Map<string, typeof rows>();
    for (const row of rows) {
      const id = String(row['milestone']);
      const own = byMilestone.get(id) ?? [];
      own.push(row);
      byMilestone.set(id, own);
    }
    const milestones = this.catalog.milestones(project);
    if (byMilestone.has('')) milestones.push({ id: '', title: '', order: Number.MAX_SAFE_INTEGER });
    const result: PlanCatalog = { plan: [], archive: [] };
    for (const milestone of milestones) {
      const own = byMilestone.get(milestone.id) ?? [];
      for (const archived of [false, true]) {
        const group = own.find((row) => Boolean(row['archived']) === archived);
        if (archived ? !group : !group && own.length) continue;
        const stage: PlanStage = {
          milestone,
          ...(milestone.id ? {} : { loose: true }),
          taskCount: Number(group?.['count'] ?? 0),
          allCount: own.reduce((n, row) => n + Number(row['count']), 0),
          done: Number(group?.['done'] ?? 0),
          total: Number(group?.['total'] ?? 0),
          working: Number(group?.['working'] ?? 0),
          attention: Number(group?.['attention'] ?? 0),
          errors: Number(group?.['errors'] ?? 0),
          canDelete: own.every((row) => !Number(row['started'])),
        };
        result[archived ? 'archive' : 'plan'].push(stage);
      }
    }
    return result;
  }
  links(project: string, id: string): TaskLink[] {
    return this.catalog.store.db
      .prepare(
        `SELECT t.id,json_extract(t.value,'$.title') AS title,t.status
      FROM task_dependencies d JOIN task_catalog t ON t.project=d.project AND t.id=d.dependency
      WHERE d.project=? AND d.id=?`,
      )
      .all(project, id)
      .map((row) => ({
        id: String(row['id']),
        title: String(row['title']),
        status: String(row['status']) as TaskLink['status'],
      }));
  }
  relations(project: string, id: string) {
    const db = this.catalog.store.db;
    return {
      up: db
        .prepare('SELECT dependency AS id FROM task_dependencies WHERE project=? AND id=?')
        .all(project, id)
        .map((row) => String(row['id'])),
      down: db
        .prepare('SELECT id FROM task_dependencies WHERE project=? AND dependency=?')
        .all(project, id)
        .map((row) => String(row['id'])),
    };
  }
}
