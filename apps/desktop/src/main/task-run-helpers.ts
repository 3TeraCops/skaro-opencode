import {
  displayStatus,
  indexTasks,
  isBlocked,
  unmergedDependencies,
  type ProjectArtifacts,
  type Task,
  type TaskRuntime,
  type RunRecord,
} from '@skaro/core';
import type { AgentId, RunInfo, TaskDetail, TaskRef, TaskSummary } from '../shared/ipc';
import { taskSections } from './task-body';
import { requirementsOf } from '../shared/task-requirements';
export { requirementsOf } from '../shared/task-requirements';
import { stageIdOf } from './task-stage';
import { subjectOf } from './task-subject';

import type { ActiveRun } from './task-run-model';

export const FLUSH_MS = 40;

export function key(projectId: string, taskId: string): string {
  return `${projectId}\n${taskId}`;
}

export function awaitingKey(projectId: string): string {
  return `tasks.${projectId}.awaitingStart`;
}

export function settingsKey(projectId: string, taskId: string): string {
  return `task.${projectId}.${taskId}.agent`;
}

/** The task of a run, or the acceptance of a stage when the run is named after a milestone. */
export function findTask(artifacts: ProjectArtifacts, taskId: string): Task {
  const task = subjectOf(artifacts, taskId);
  if (!task) throw new Error(`unknown task ${taskId}`);
  return task;
}

export function runInfo(active: ActiveRun): RunInfo {
  return {
    id: active.run.id,
    agent: active.run.agent as AgentId,
    startedAt: active.run.startedAt,
    ...(active.run.worktree ? { worktree: active.run.worktree } : {}),
    ...(active.run.branch ? { branch: active.run.branch } : {}),
    live: active.session !== undefined,
  };
}

export function ref(
  task: Task,
  index: ReturnType<typeof indexTasks>,
  runtime?: TaskRuntime,
): TaskRef {
  return { id: task.id, title: task.title, status: displayStatus(task, index, runtime) };
}

export function summary(
  task: Task,
  artifacts: ProjectArtifacts,
  index: ReturnType<typeof indexTasks>,
  runtime: TaskRuntime | undefined,
  extra: { agent?: AgentId; model?: string; updatedAt: number },
  catalogs?: {
    milestones: ReadonlyMap<string, ProjectArtifacts['milestones'][number]>;
    specs: ReadonlyMap<string, ProjectArtifacts['specs'][number]>;
  },
): TaskSummary {
  const milestone = catalogs
    ? catalogs.milestones.get(task.milestone ?? '')
    : artifacts.milestones.find((m) => m.id === task.milestone);
  const spec = task.spec
    ? catalogs
      ? catalogs.specs.get(task.spec)
      : artifacts.specs.find((s) => s.id === task.spec)
    : undefined;
  const base = ref(task, index, runtime);
  const waitsFor = isBlocked(task, index) ? unmergedDependencies(task, index) : [];
  return {
    ...base,
    ...(base.status === 'blocked' && !waitsFor.length ? { status: 'todo' as const } : {}),
    stage: task.status,
    ...(milestone ? { milestone: { id: milestone.id, title: milestone.title } } : {}),
    ...(spec ? { spec: { id: spec.id, title: spec.title, path: spec.path } } : {}),
    archived: task.archived,
    ...extra,
    deps: task.dependsOn,
    ...(task.order !== undefined ? { order: task.order } : {}),
    waitsFor,
  };
}

export function detail(
  task: Task,
  artifacts: ProjectArtifacts,
  runtime: Map<string, { state: TaskRuntime }>,
  run?: RunRecord,
): TaskDetail {
  const index = indexTasks(artifacts.tasks);
  const refOf = (t: Task) => ref(t, index, runtime.get(t.id)?.state);
  return {
    ...summary(task, artifacts, index, runtime.get(task.id)?.state, { updatedAt: 0 }),
    dependsOn: task.dependsOn.map(
      (id) => (index.get(id) && refOf(index.get(id)!)) ?? { id, title: id, status: 'todo' },
    ),
    blocks: artifacts.tasks.filter((t) => t.dependsOn.includes(task.id)).map(refOf),
    ...((task.branch ?? run?.branch) ? { branch: task.branch ?? run?.branch } : {}),
    ...(run && stageIdOf(run) ? { sharedCheckout: true } : {}),
    ...taskSections(task.body),
    ...requirementsOf(artifacts.specs.find((s) => s.id === task.spec)?.body),
  };
}
