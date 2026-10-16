import type { AppDb, ProjectArtifacts } from '@skaro/core';
import {
  CompletionStore,
  criteriaRevision,
  type ResultDependency,
  type TaskResult,
} from './completion-store';

export function preparedDependencies(db: AppDb, projectId: string, taskId: string): TaskResult[] {
  return db.getSetting(`completion.${projectId}.dependencies.${taskId}`, []);
}

/** Freeze provenance with the submitted result instead of reading mutable task branches later. */
export function dependencySnapshot(results: TaskResult[]): ResultDependency[] {
  const inputs = new Map<string, ResultDependency>();
  for (const result of results)
    for (const input of [
      { taskId: result.taskId, head: result.head },
      ...(result.dependencies ?? []),
    ]) {
      const previous = inputs.get(input.taskId);
      if (previous && previous.head !== input.head)
        throw new Error(`${input.taskId}: dependencies contain different accepted results`);
      inputs.set(input.taskId, input);
    }
  return [...inputs.values()];
}

/** A submitted dependency may itself contain inputs that have since been reopened or replaced. */
export function assertDependencyVersions(
  artifacts: ProjectArtifacts,
  inputs: ResultDependency[],
  store: CompletionStore,
  taskId: string,
): void {
  const tasks = new Map(artifacts.tasks.map((task) => [task.id, task]));
  for (const input of inputs) {
    const task = tasks.get(input.taskId);
    const current = store.result(input.taskId);
    if (
      !task ||
      !['review', 'done'].includes(task.status) ||
      !current ||
      current.head !== input.head ||
      current.criteria !== criteriaRevision(task)
    )
      throw new Error(
        `${taskId}: dependency ${input.taskId} changed after integration; integrate it again and resubmit the result`,
      );
  }
}

/** Inputs of a publication that are neither published nor merged together with it. */
export function publicationBlockers(
  artifacts: ProjectArtifacts,
  results: Pick<TaskResult, 'taskId' | 'dependencies'>[],
): { task: string; dependency: string }[] {
  const tasks = new Map(artifacts.tasks.map((task) => [task.id, task]));
  const scope = new Set(results.map((result) => result.taskId));
  const blockers: { task: string; dependency: string }[] = [];
  for (const result of results) {
    const task = tasks.get(result.taskId);
    if (!task) continue;
    const inputs = new Set([
      ...task.dependsOn,
      ...(result.dependencies ?? []).map((input) => input.taskId),
    ]);
    for (const id of inputs) {
      const dependency = tasks.get(id);
      if (
        !dependency ||
        (dependency.status !== 'done' && !(dependency.status === 'review' && scope.has(id)))
      )
        blockers.push({ task: task.id, dependency: id });
    }
  }
  return blockers;
}

/** Starting with review inputs does not authorize publishing tasks outside the selected scope. */
export function assertPublicationDependencies(
  artifacts: ProjectArtifacts,
  results: TaskResult[],
  store: CompletionStore,
): void {
  const tasks = new Map(artifacts.tasks.map((task) => [task.id, task]));
  const blockers = publicationBlockers(artifacts, results);
  for (const result of results) {
    const task = tasks.get(result.taskId);
    if (!task) throw new Error(`Task ${result.taskId} was removed`);
    const blocker = blockers.find((item) => item.task === task.id);
    if (blocker)
      throw new Error(
        `${task.id}: dependency ${blocker.dependency} must be published first or included in the same publication`,
      );
    assertDependencyVersions(
      artifacts,
      (result.dependencies ?? []).filter((input) => tasks.get(input.taskId)?.status !== 'done'),
      store,
      task.id,
    );
  }
}
