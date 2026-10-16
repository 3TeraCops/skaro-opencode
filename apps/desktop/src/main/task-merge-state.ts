// How the merge of every task stands, as the board, the list and the plan say it: the owner sees
// what is merged now, what waits in line and behind which task, and where a conflict or an error
// stopped it. Nothing of it is stored apart from the facts it reads.

import type { ProjectArtifacts } from '@skaro/core';
import { AUTO_MERGE_KEY, type MergeProgress } from '../shared/ipc';
import { publicationBlockers } from './completion-dependencies';
import { CompletionStore } from './completion-store';
import { mergeProgress, type IntegrationOperation } from './integration-model';
import type { TaskRunEngine } from './task-run-engine';

export interface TaskMergeState {
  merge: MergeProgress;
  /** The task whose merge or conflict this one waits for. */
  mergeAfter?: string;
  /** A candidate from before merges went per task: its agent says what it does. */
  operation?: IntegrationOperation;
}

export function taskMergeStates(
  ctx: TaskRunEngine,
  projectId: string,
  artifacts: ProjectArtifacts,
): Map<string, TaskMergeState> {
  const db = ctx.deps.db;
  const store = new CompletionStore(db, projectId);
  const issues = store.issues();
  const conflicts = store.conflicts();
  const runtime = db.getTaskRuntime(projectId);
  const integrations = ctx.integrations.store.all(projectId);
  const auto = db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true;
  const merging = ctx.merges.coordinator.merging(projectId);
  const working = (id: string) => ['queued', 'running'].includes(runtime.get(id)?.state ?? '');
  // The task whose agent resolves a conflict now: the automatic merge of the others waits for it.
  const resolving = artifacts.tasks.find(
    (task) => task.status === 'in_progress' && conflicts.includes(task.id) && working(task.id),
  )?.id;
  const states = new Map<string, TaskMergeState>();
  for (const task of artifacts.tasks) {
    if (task.archived) continue;
    if (task.status === 'in_progress' && conflicts.includes(task.id))
      states.set(task.id, { merge: 'conflict' });
    if (task.status !== 'review') continue;
    const candidate = mergeProgress(integrations, task.id);
    if (candidate)
      states.set(task.id, { merge: candidate.progress, operation: candidate.operation });
    else if (merging === task.id) states.set(task.id, { merge: 'running' });
    else if (issues[task.id]) states.set(task.id, { merge: 'failed' });
    else if (auto) {
      // With the automatic merge an accepted task waits for Skaro, not for the owner.
      const dependency = publicationBlockers(artifacts, [
        store.result(task.id) ?? { taskId: task.id },
      ])[0]?.dependency;
      const after = dependency ?? resolving ?? merging;
      states.set(task.id, { merge: 'queued', ...(after ? { mergeAfter: after } : {}) });
    }
  }
  return states;
}
