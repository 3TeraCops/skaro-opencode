import type { PlanCatalogMethods, TaskLink } from './plan-catalog';
import type { TaskSummary } from './ipc-entities';
import type { BoardStatus, TaskColumn } from './task-presentation';
export interface TaskFilters {
  query: string;
  milestones: string[];
  statuses: BoardStatus[];
  agents: string[];
}
export interface TaskQuery extends Partial<TaskFilters> {
  kind?: 'tasks' | 'list' | 'active' | 'plan';
  column?: TaskColumn;
  spec?: string;
  archived?: boolean;
  moved?: Partial<Record<string, TaskColumn>>;
}
export interface TaskRange {
  projectId: string;
  key: string;
  revision: number;
  count: number;
  done: number;
  query: TaskQuery;
}
export interface TaskFacets {
  total: number;
  working: number;
  attention: number;
  milestones: Record<string, number>;
  statuses: Partial<Record<BoardStatus, number>>;
  agents: Record<string, number>;
}
export interface TaskCatalogInfo {
  revision: number;
  milestones: { id: string; title: string; order: number }[];
  facets: TaskFacets;
  active: TaskRange;
}
export type TaskEntry = { id: string; index: number } & (
  | { kind: 'task'; task: TaskSummary; first: boolean; last: boolean; dependencies?: TaskLink[] }
  | { kind: 'header'; group: { id: string; title: string; done: number; total: number } }
);
export interface TaskCatalogMethods extends PlanCatalogMethods {
  'tasks.catalog': (projectId: string) => TaskCatalogInfo;
  'tasks.query': (projectId: string, query: TaskQuery) => TaskRange;
  'tasks.page': (range: TaskRange, start: number) => TaskEntry[];
  'tasks.find': (range: TaskRange, id: string) => number;
  'tasks.select': (range: TaskRange) => TaskSummary[];
  'tasks.selected': (projectId: string, ids: string[]) => TaskSummary[];
  'tasks.reorder': (range: TaskRange, id: string, column: TaskColumn, index: number) => void;
}
