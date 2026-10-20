import { indexTasks, type AppDb, type ProjectArtifacts, type RunRecord } from '@skaro/core';
import type { TaskSummary } from '../shared/ipc';
import { summary } from './task-run-helpers';
import { taskListAssignment } from './task-list-assignment';
import { projectTaskMerges } from './task-merge-state';
import { stageWaits } from './task-stage-waits';
import type { IntegrationOperation } from './integration-model';
export interface TaskListSnapshot {
  tasks: TaskSummary[];
  operations: Record<string, string>;
  milestones: { id: string; title: string; order: number }[];
}
/** UI summaries depend on frontmatter and runtime facts, never task bodies or old run logs. */
export function taskListSnapshot(
  db: AppDb,
  projectId: string,
  artifacts: ProjectArtifacts,
  mtimes: ReadonlyMap<string, number>,
  integrations: IntegrationOperation[],
  merging?: string,
): TaskListSnapshot {
  const runtime = db.getTaskRuntime(projectId);
  const index = indexTasks(artifacts.tasks);
  const latest = new Map<string, RunRecord>();
  for (const task of artifacts.tasks) {
    const run = db.latestRun(projectId, task.id);
    if (run) latest.set(task.id, run);
  }
  const waits = stageWaits(artifacts.tasks, runtime, latest);
  const merges = projectTaskMerges(db, projectId, artifacts, integrations, merging);
  const catalogs = {
    milestones: new Map(artifacts.milestones.map((m) => [m.id, m])),
    specs: new Map(artifacts.specs.map((s) => [s.id, s])),
  };
  const operations: Record<string, string> = {};
  const tasks = artifacts.tasks.map((task) => {
    const run = latest.get(task.id);
    const result = summary(
      task,
      artifacts,
      index,
      runtime.get(task.id)?.state,
      {
        ...taskListAssignment(db, projectId, task, run, artifacts),
        updatedAt: Math.max(mtimes.get(task.id) ?? 0, run?.endedAt ?? run?.startedAt ?? 0),
      },
      catalogs,
    );
    const state = merges.get(task.id);
    if (state) result.merge = state.merge;
    if (state?.mergeAfter) result.mergeAfter = state.mergeAfter;
    if (state?.merge === 'running' && state.operation) operations[task.id] = state.operation.id;
    return { ...result, ...(waits.has(task.id) ? { after: waits.get(task.id) } : {}) };
  });
  return {
    tasks,
    operations,
    milestones: artifacts.milestones.map(({ id, title, order }) => ({ id, title, order })),
  };
}
