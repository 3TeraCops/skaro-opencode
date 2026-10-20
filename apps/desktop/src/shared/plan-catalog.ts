import type { MilestoneInfo, TaskSummary } from './ipc-entities';
export interface PlanStage {
  milestone: MilestoneInfo;
  loose?: boolean;
  taskCount: number;
  allCount: number;
  done: number;
  total: number;
  working: number;
  attention: number;
  errors: number;
  canDelete: boolean;
}
export interface PlanCatalog {
  plan: PlanStage[];
  archive: PlanStage[];
}
export type TaskLink = Pick<TaskSummary, 'id' | 'title' | 'status'>;
export interface PlanCatalogMethods {
  'plan.catalog': (project: string) => PlanCatalog;
  'plan.milestone': (project: string, id: string) => MilestoneInfo | undefined;
  'plan.relations': (project: string, id: string) => { up: string[]; down: string[] };
  'plan.archiveGroup': (project: string, milestone: string, archived: boolean) => void;
}
