import type { TaskSummary } from '../../shared/ipc-entities';
import { activeKind, boardStatus, columnOf } from '../../shared/task-presentation';
import type { TaskListSnapshot } from '../task-list-reader';
import type { PayloadStore } from './payload-store';

/** Disposable, indexed metadata. Authoritative task files and runtime records stay in their stores. */
export class TaskCatalogStore {
  readonly store: PayloadStore;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_catalog (
      project TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,archived INTEGER NOT NULL,
      status TEXT NOT NULL,board_status TEXT NOT NULL,board_column TEXT,milestone TEXT NOT NULL,
      spec TEXT NOT NULL,agent TEXT NOT NULL,search TEXT NOT NULL,active_kind TEXT,ordering REAL NOT NULL,
      value TEXT NOT NULL,operation TEXT,PRIMARY KEY(project,id));
      CREATE INDEX IF NOT EXISTS task_catalog_columns ON task_catalog(project,archived,board_column,position);
      CREATE INDEX IF NOT EXISTS task_catalog_milestones ON task_catalog(project,archived,milestone,ordering,position);
      CREATE INDEX IF NOT EXISTS task_catalog_specs ON task_catalog(project,spec,archived,position);
      CREATE INDEX IF NOT EXISTS task_catalog_active ON task_catalog(project,archived,active_kind,position);
      CREATE TABLE IF NOT EXISTS task_dependencies(project TEXT NOT NULL,id TEXT NOT NULL,dependency TEXT NOT NULL,
        PRIMARY KEY(project,id,dependency));
      CREATE INDEX IF NOT EXISTS task_dependents ON task_dependencies(project,dependency,id);
      CREATE TABLE IF NOT EXISTS task_catalog_state(project TEXT PRIMARY KEY,revision INTEGER NOT NULL,milestones TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_queries(key TEXT PRIMARY KEY,project TEXT NOT NULL,revision INTEGER NOT NULL,count INTEGER NOT NULL,done INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS task_queries_project ON task_queries(project,revision);
      CREATE TABLE IF NOT EXISTS task_query_rows(key TEXT NOT NULL,position INTEGER NOT NULL,id TEXT NOT NULL,
        header TEXT,first INTEGER NOT NULL,last INTEGER NOT NULL,PRIMARY KEY(key,position));
      CREATE INDEX IF NOT EXISTS task_query_ids ON task_query_rows(key,id);
      CREATE TABLE IF NOT EXISTS task_board_order(project TEXT NOT NULL,column_key TEXT NOT NULL,
        id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(project,column_key,id));`);
  }
  publish(
    project: string,
    snapshot: TaskListSnapshot,
    order: Partial<Record<string, string[]>>,
  ): number {
    return this.store.transaction(() => {
      const upsert = this.store.db
        .prepare(`INSERT INTO task_catalog VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project,id) DO UPDATE SET position=excluded.position,archived=excluded.archived,
        status=excluded.status,board_status=excluded.board_status,board_column=excluded.board_column,
        milestone=excluded.milestone,spec=excluded.spec,agent=excluded.agent,search=excluded.search,
        active_kind=excluded.active_kind,ordering=excluded.ordering,value=excluded.value,operation=excluded.operation`);
      this.store.db.prepare('DELETE FROM task_dependencies WHERE project=?').run(project);
      const edge = this.store.db.prepare('INSERT OR IGNORE INTO task_dependencies VALUES (?,?,?)');
      const ids = new Set<string>();
      snapshot.tasks.forEach((task, position) => {
        ids.add(task.id);
        for (const dependency of task.deps) edge.run(project, task.id, dependency);
        upsert.run(
          project,
          task.id,
          position,
          Number(task.archived),
          task.status,
          boardStatus(task.status),
          columnOf(task) ?? null,
          task.milestone?.id ?? '',
          task.spec?.id ?? '',
          task.agent ?? 'none',
          `${task.id} ${task.title}`.toLowerCase(),
          activeKind(task) ?? null,
          task.order ?? 0,
          JSON.stringify(task),
          snapshot.operations[task.id] ?? null,
        );
      });
      for (const row of this.store.db
        .prepare('SELECT id FROM task_catalog WHERE project=?')
        .all(project))
        if (!ids.has(String(row['id'])))
          this.store.db
            .prepare('DELETE FROM task_catalog WHERE project=? AND id=?')
            .run(project, String(row['id']));
      this.store.db
        .prepare(
          `INSERT INTO task_catalog_state VALUES (?,1,?) ON CONFLICT(project)
        DO UPDATE SET revision=revision+1,milestones=excluded.milestones`,
        )
        .run(project, JSON.stringify(snapshot.milestones));
      this.store.db.prepare('DELETE FROM task_board_order WHERE project=?').run(project);
      const place = this.store.db.prepare(
        'INSERT OR REPLACE INTO task_board_order VALUES (?,?,?,?)',
      );
      for (const [column, entries] of Object.entries(order))
        entries?.forEach((id, at) => place.run(project, column, id, at));
      const revision = this.revision(project);
      for (const row of this.store.db
        .prepare('SELECT key FROM task_queries WHERE project=? AND revision<?')
        .all(project, revision - 8)) {
        this.store.db.prepare('DELETE FROM task_query_rows WHERE key=?').run(String(row['key']));
        this.store.db.prepare('DELETE FROM task_queries WHERE key=?').run(String(row['key']));
      }
      return revision;
    });
  }
  revision(project: string): number {
    return Number(
      this.store.db
        .prepare('SELECT revision FROM task_catalog_state WHERE project=?')
        .get(project)?.['revision'] ?? 0,
    );
  }
  milestones(project: string): { id: string; title: string; order: number }[] {
    const row = this.store.db
      .prepare('SELECT milestones FROM task_catalog_state WHERE project=?')
      .get(project);
    return JSON.parse(String(row?.['milestones'] ?? '[]'));
  }
  selected(project: string, ids: string[], preserveOrder = false): TaskSummary[] {
    const result: { task: TaskSummary; position: number }[] = [];
    const query = this.store.db.prepare(
      'SELECT value,position FROM task_catalog WHERE project=? AND id=? AND archived=0',
    );
    for (const id of new Set(ids)) {
      const row = query.get(project, id);
      if (row)
        result.push({
          task: JSON.parse(String(row['value'])) as TaskSummary,
          position: Number(row['position']),
        });
    }
    return (preserveOrder ? result : result.toSorted((a, b) => a.position - b.position)).map(
      (row) => row.task,
    );
  }
}
