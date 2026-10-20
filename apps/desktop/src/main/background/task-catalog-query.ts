import { PlanCatalogQuery } from './plan-catalog-query';
import { createHash } from 'node:crypto';
import type { TaskQuery, TaskRange, TaskFacets, TaskEntry } from '../../shared/task-catalog';
import type { TaskSummary } from '../../shared/ipc-entities';
import type { TaskCatalogStore } from './task-catalog-store';

export class TaskCatalogQuery {
  private readonly catalog: TaskCatalogStore;
  constructor(catalog: TaskCatalogStore) {
    this.catalog = catalog;
  }
  facets(project: string): TaskFacets {
    const db = this.catalog.store.db;
    const counts = (field: string): Record<string, number> =>
      Object.fromEntries(
        db
          .prepare(
            `SELECT ${field} AS name,count(*) AS count FROM task_catalog WHERE project=? AND archived=0 GROUP BY ${field}`,
          )
          .all(project)
          .map((row) => [String(row['name']), Number(row['count'])]),
      );
    const statuses = counts('board_status');
    const attention = db
      .prepare(
        `SELECT count(*) AS count FROM task_catalog WHERE project=? AND archived=0 AND active_kind IN ('need','review')`,
      )
      .get(project);
    return {
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
      working: Number(
        db
          .prepare(
            "SELECT count(*) AS count FROM task_catalog WHERE project=? AND archived=0 AND status='in_progress'",
          )
          .get(project)?.['count'] ?? 0,
      ),
      attention: Number(attention?.['count'] ?? 0),
      statuses,
      milestones: counts('milestone'),
      agents: counts('agent'),
    };
  }
  range(project: string, q: TaskQuery = {}): TaskRange {
    const db = this.catalog.store.db,
      revision = this.catalog.revision(project);
    const key = createHash('sha256')
      .update(JSON.stringify([project, revision, q]))
      .digest('hex');
    const saved = db.prepare('SELECT count,done FROM task_queries WHERE key=?').get(key);
    if (saved)
      return {
        projectId: project,
        key,
        revision,
        count: Number(saved['count']),
        done: Number(saved['done']),
        query: q,
      };
    const args: (string | number)[] = [project, q.archived ? 1 : 0];
    const conditions = ['t.project=?', 't.archived=?'];
    const inList = (field: string, values: string[] | undefined) => {
      if (!values?.length) return;
      conditions.push(`${field} IN (${values.map(() => '?').join(',')})`);
      args.push(...values);
    };
    inList('t.milestone', q.milestones);
    inList('t.board_status', q.statuses);
    inList('t.agent', q.agents);
    if (q.spec !== undefined) {
      conditions.push('t.spec=?');
      args.push(q.spec);
    }
    if (q.kind === 'active') conditions.push('t.active_kind IS NOT NULL');
    if (q.query?.trim()) {
      conditions.push('instr(t.search,?)>0');
      args.push(q.query.trim().toLowerCase());
    }
    if (q.column) {
      const moved = Object.entries(q.moved ?? {}),
        incoming = moved.filter(([, to]) => to === q.column).map(([id]) => id);
      let condition = 't.board_column=?';
      args.push(q.column);
      if (moved.length) {
        condition += ` AND t.id NOT IN (${moved.map(() => '?').join(',')})`;
        args.push(...moved.map(([id]) => id));
      }
      if (incoming.length) {
        condition = `(${condition}) OR t.id IN (${incoming.map(() => '?').join(',')})`;
        args.push(...incoming);
      }
      conditions.push(`(${condition})`);
    }
    const order = q.column
      ? 'COALESCE(o.position,9223372036854775807),t.position'
      : q.kind === 'active'
        ? "CASE t.active_kind WHEN 'need' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,t.position"
        : q.kind === 'plan'
          ? 't.ordering,t.position'
          : 't.position';
    // Overlay column membership is resolved over the indexed filter result in the worker.

    const records = db
      .prepare(
        `SELECT t.id,t.milestone,t.status,t.board_column FROM task_catalog t
      LEFT JOIN task_board_order o ON o.project=t.project AND o.column_key=? AND o.id=t.id
      WHERE ${conditions.join(' AND ')} ORDER BY ${order}`,
      )
      .all(q.column ?? '', ...args);
    const visible = records;
    const milestones = q.kind === 'list' ? this.catalog.milestones(project) : [];
    this.catalog.store.transaction(() => {
      const insert = db.prepare('INSERT INTO task_query_rows VALUES (?,?,?,?,?,?)');
      let position = 0;
      const write = (id: string, header: unknown, first = false, last = false) =>
        insert.run(
          key,
          position++,
          id,
          header ? JSON.stringify(header) : null,
          Number(first),
          Number(last),
        );
      if (q.kind === 'list') {
        const grouped = new Map<string, typeof visible>();
        for (const row of visible) {
          const id = String(row['milestone']);
          const group = grouped.get(id) ?? [];
          group.push(row);
          grouped.set(id, group);
        }
        const ordered = grouped.has('') ? [...milestones, { id: '', title: '' }] : milestones;
        for (const milestone of ordered) {
          const group = grouped.get(milestone.id);
          if (!group?.length) continue;
          write(`group:${milestone.id}`, {
            ...milestone,
            total: group.length,
            done: group.filter((row) => row['status'] === 'done').length,
          });
          group.forEach((row, index) =>
            write(String(row['id']), undefined, index === 0, index === group.length - 1),
          );
        }
      } else visible.forEach((row) => write(String(row['id']), undefined));
      db.prepare('INSERT INTO task_queries VALUES (?,?,?,?,?)').run(
        key,
        project,
        revision,
        position,
        visible.filter((row) => row['status'] === 'done').length,
      );
      for (const row of db
        .prepare(
          'SELECT key FROM task_queries WHERE project=? ORDER BY rowid DESC LIMIT -1 OFFSET 64',
        )
        .all(project)) {
        db.prepare('DELETE FROM task_query_rows WHERE key=?').run(String(row['key']));
        db.prepare('DELETE FROM task_queries WHERE key=?').run(String(row['key']));
      }
    });
    return {
      projectId: project,
      key,
      revision,
      done: visible.filter((row) => row['status'] === 'done').length,
      query: q,
      count: Number(
        db.prepare('SELECT count,done FROM task_queries WHERE key=?').get(key)!['count'],
      ),
    };
  }
  page(source: TaskRange, start: number) {
    this.verify(source);
    const operations: Record<string, string> = {};
    const entries: TaskEntry[] = this.catalog.store.db
      .prepare(
        `SELECT q.*,t.value,t.operation FROM task_query_rows q
      LEFT JOIN task_catalog t ON t.project=? AND t.id=q.id
      WHERE q.key=? AND q.position>=? AND q.position<? ORDER BY q.position`,
      )
      .all(source.projectId, source.key, Math.max(0, start), Math.max(0, start) + 16)
      .flatMap<TaskEntry>((row) => {
        const id = String(row['id']),
          index = Number(row['position']);
        if (row['header'])
          return [{ id, index, kind: 'header' as const, group: JSON.parse(String(row['header'])) }];
        if (!row['value']) return [];
        if (row['operation']) operations[id] = String(row['operation']);
        return [
          {
            id,
            index,
            kind: 'task' as const,
            task: JSON.parse(String(row['value'])) as TaskSummary,
            ...(source.query.kind === 'plan'
              ? { dependencies: new PlanCatalogQuery(this.catalog).links(source.projectId, id) }
              : {}),
            first: !!row['first'],
            last: !!row['last'],
          },
        ];
      });
    return { entries, operations };
  }
  ids(source: TaskRange): string[] {
    this.verify(source);
    return this.catalog.store.db
      .prepare('SELECT id FROM task_query_rows WHERE key=? AND header IS NULL ORDER BY position')
      .all(source.key)
      .map((row) => String(row['id']));
  }
  find(source: TaskRange, id: string): number {
    this.verify(source);
    return Number(
      this.catalog.store.db
        .prepare('SELECT position FROM task_query_rows WHERE key=? AND id=?')
        .get(source.key, id)?.['position'] ?? -1,
    );
  }
  private verify(source: TaskRange) {
    let row = this.catalog.store.db
      .prepare('SELECT project FROM task_queries WHERE key=?')
      .get(source.key);
    if (!row && source.revision === this.catalog.revision(source.projectId)) {
      this.range(source.projectId, source.query);
      row = this.catalog.store.db
        .prepare('SELECT project FROM task_queries WHERE key=?')
        .get(source.key);
    }
    if (row?.['project'] !== source.projectId) throw new Error('Task query expired');
  }
}
