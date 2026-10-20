import { randomUUID } from 'node:crypto';
import { currentActivity } from '@skaro/timeline';
import type { TaskEntry, TaskQuery, TaskRange } from '../shared/task-catalog';
import type { TaskColumn } from '../shared/task-presentation';
import type { TaskSummary } from '../shared/ipc-entities';
import type { TaskRunEngine } from './task-run-engine';
import { background } from './background/client';
import { key } from './task-run-helpers';

export class TaskCatalogService {
  private readonly ctx: TaskRunEngine;
  private readonly epoch = randomUUID();
  private readonly versions = new Map<string, number>();
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  invalidate(project: string) {
    this.versions.set(project, (this.versions.get(project) ?? 0) + 1);
  }
  private args(project: string): [string, string, string, string | undefined] {
    this.ctx.project(project);
    return [
      this.ctx.deps.db.filePath,
      project,
      `${this.epoch}:${this.versions.get(project) ?? 0}`,
      this.ctx.merges.coordinator.merging(project),
    ];
  }
  sync(project: string) {
    return background(this.ctx.deps.dataDir, 'tasks.catalog.sync', ...this.args(project));
  }
  private ensure(project: string) {
    return background(this.ctx.deps.dataDir, 'tasks.catalog.ensure', ...this.args(project));
  }
  async plan(project: string) {
    await this.ensure(project);
    return background(this.ctx.deps.dataDir, 'tasks.catalog.plan', project);
  }
  async relations(project: string, id: string) {
    await this.ensure(project);
    return background(this.ctx.deps.dataDir, 'tasks.catalog.relations', project, id);
  }
  milestone(project: string, id: string) {
    const root = this.ctx.project(project).root;
    return background(this.ctx.deps.dataDir, 'tasks.catalog.milestone', root, id);
  }
  async groupIds(project: string, milestone: string, archived: boolean) {
    const source = await this.query(project, { kind: 'plan', milestones: [milestone], archived });
    return background(this.ctx.deps.dataDir, 'tasks.catalog.ids', source);
  }
  async query(project: string, query: TaskQuery) {
    await this.ensure(project);
    return background(this.ctx.deps.dataDir, 'tasks.catalog.query', project, query);
  }
  async page(source: TaskRange, start: number): Promise<TaskEntry[]> {
    const result = await background(this.ctx.deps.dataDir, 'tasks.catalog.page', source, start);
    for (const entry of result.entries)
      if (entry.kind === 'task') {
        const task = entry.task;
        const active = this.ctx.active.get(key(source.projectId, task.id));
        if (task.status === 'in_progress' && active)
          task.activity = currentActivity(active.timeline.state);
        const id = result.operations[task.id];
        const operation = id && this.ctx.integrations.store.find(source.projectId, id);
        if (operation) task.activity = await this.ctx.integrations.history.activity(operation);
      }
    return result.entries;
  }
  find(source: TaskRange, id: string) {
    return background(this.ctx.deps.dataDir, 'tasks.catalog.find', source, id);
  }
  async select(source: TaskRange): Promise<TaskSummary[]> {
    await this.ensure(source.projectId);
    return background(this.ctx.deps.dataDir, 'tasks.catalog.select', source);
  }
  async selected(project: string, ids: string[]): Promise<TaskSummary[]> {
    await this.ensure(project);
    return background(this.ctx.deps.dataDir, 'tasks.catalog.selected', project, ids);
  }
  async reorder(source: TaskRange, id: string, column: TaskColumn, index: number): Promise<void> {
    const ids = await background(this.ctx.deps.dataDir, 'tasks.catalog.place', source, id, index);
    const setting = `tasks.${source.projectId}.boardOrder`;
    const order = this.ctx.deps.db.getSetting<Record<string, string[]>>(setting, {});
    this.ctx.deps.db.setSetting(setting, { ...order, [column]: ids });
    this.invalidate(source.projectId);
  }
}
