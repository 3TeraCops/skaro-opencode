// Where a stage stands, as "План" and the stage screen show it. Nothing of it is stored: it is
// read from the task files, the runtime of the agents and the queue.

import {
  hasFailed,
  indexTasks,
  isBlocked,
  pendingDependencies,
  type Milestone,
  type ProjectArtifacts,
  type Task,
  type TaskRuntime,
} from '@skaro/core';
import type { StageInfo } from '../shared/ipc';
import type { IntegrationOperation } from './integration-model';
import { stageTasks } from './task-stage';

const finished = (task: Task) => task.status === 'review' || task.status === 'done';

const NOTICES: Record<string, { review: string; need: string }> = {
  ru: { review: 'Этап {id} ждёт слияния', need: 'Приёмка {id}: нужен ответ' },
  en: { review: 'Milestone {id} awaits the merge', need: 'Acceptance of {id}: needs an answer' },
};

/** The words of a system notification about a stage; other kinds keep the usual ones. */
export function stageNotice(kind: string, stageId: string, locale: string): string | undefined {
  const words = NOTICES[locale] ?? NOTICES['en']!;
  return kind === 'review' || kind === 'need' ? words[kind].replace('{id}', stageId) : undefined;
}

/** Tasks of the stage in the order they run: the order of the plan. */
export function orderedStageTasks(stage: Pick<Milestone, 'id'>, artifacts: ProjectArtifacts) {
  return stageTasks(stage, artifacts)
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

export function stageInfo(
  stage: Milestone,
  artifacts: ProjectArtifacts,
  runtime: ReadonlyMap<string, { state: TaskRuntime }>,
  options: {
    /** Tasks told to start that wait for their dependencies. */
    awaiting: ReadonlySet<string>;
    /** The acceptance of the stage has been started at least once. */
    accepted: boolean;
    /** Integrations of the project: the merge of the stage is the last one of its tasks. */
    integrations: readonly IntegrationOperation[];
  },
): StageInfo {
  const tasks = orderedStageTasks(stage, artifacts);
  const state = (id: string) => runtime.get(id)?.state;
  // The merge works on accepted results: its tasks stay in review, the stage says how it goes.
  const merge = options.integrations.findLast(
    (op) => op.purpose === 'publication' && tasks.some((t) => t.id === op.taskId),
  );
  const all = indexTasks(artifacts.tasks);
  const base = {
    id: stage.id,
    finished: tasks.filter(finished).length,
    total: tasks.length,
    mergeable: tasks.filter((t) => t.status === 'review').length,
    ...(stage.branch ? { branch: stage.branch } : {}),
  };
  if (tasks.length && tasks.every((t) => t.status === 'done')) return { ...base, state: 'done' };

  const failed = tasks.find((t) => hasFailed(t, state(t.id)));
  if (failed) return { ...base, state: 'error', task: failed.id };
  if (merge?.state === 'failed') return { ...base, state: 'error', task: merge.taskId };
  const running = tasks.find((t) => state(t.id) === 'running');
  if (running) return { ...base, state: 'running', task: running.id };
  if (merge?.executor) return { ...base, state: 'running', task: merge.taskId };
  const waiting = tasks.find(
    (t) => state(t.id) === 'waiting' || (t.status === 'in_progress' && state(t.id) !== 'queued'),
  );
  if (waiting) return { ...base, state: 'needs_answer', task: waiting.id };

  if (tasks.length && tasks.every(finished)) {
    return { ...base, state: 'awaiting_merge' };
  }

  const queued = tasks.find((t) => state(t.id) === 'queued' || options.awaiting.has(t.id));
  if (queued) return { ...base, state: 'queued', task: queued.id };
  if (tasks.some((t) => t.status !== 'todo')) return { ...base, state: 'stopped' };

  // Not started. It cannot be while its first task waits for a task of another stage.
  const first = tasks[0];
  if (first && tasks.every((t) => isBlocked(t, all))) {
    const dep = pendingDependencies(first, all)
      .map((id) => all.get(id))
      .find((t) => t && t.milestone !== stage.id);
    if (dep) {
      return {
        ...base,
        state: 'idle',
        waitsFor: { task: dep.id, ...(dep.milestone ? { stage: dep.milestone } : {}) },
      };
    }
  }
  return { ...base, state: 'idle' };
}
