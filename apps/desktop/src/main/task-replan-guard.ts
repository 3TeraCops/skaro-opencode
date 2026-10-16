import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { git, taskBranch, type AppDb, type ProjectArtifacts, type Task } from '@skaro/core';
import type { ProjectContext } from './projects';
import { awaitingKey } from './task-run-helpers';
import { taskSections } from './task-body';

export function fingerprint(value: object): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item))
          return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
        return item;
      }),
    )
    .digest('hex');
}

export function replanContextFingerprint(artifacts: ProjectArtifacts): string {
  return fingerprint({ milestones: artifacts.milestones, specs: artifacts.specs });
}

export function assertReplanArtifacts(artifacts: ProjectArtifacts): void {
  if (new Set(artifacts.tasks.map((task) => task.id)).size !== artifacts.tasks.length)
    throw new Error('Duplicate task identities prevent safe replanning or reverting.');
  const problem = artifacts.problems.find((p) =>
    /(?:tasks|specs|milestones)\/|config\.yaml$/.test(p.path.replaceAll('\\', '/')),
  );
  if (problem)
    throw new Error(
      `${problem.path}: repair the unreadable artifact before replanning. ${problem.message}`,
    );
}

export function unstartedTaskProblem(
  db: AppDb,
  dataDir: string,
  projectId: string,
  task: Task,
): string | undefined {
  const runtime = db.getTaskRuntime(projectId).get(task.id);
  const scheduled = db.getSetting<Record<string, unknown>>(awaitingKey(projectId), {});
  const sections = taskSections(task.body);
  if (
    task.status !== 'todo' ||
    task.archived ||
    task.branch ||
    sections.criteria.some((c) => c.done) ||
    sections.summary ||
    db.getSetting(`startup.${projectId}.${task.id}`, null) ||
    db.listRuns(projectId, task.id, { includeRetired: true }).length ||
    (runtime && runtime.state !== 'idle') ||
    scheduled[task.id] ||
    existsSync(join(dataDir, 'worktrees', projectId, task.id))
  ) {
    return 'only tasks that have never started and are not queued or scheduled can be replanned';
  }
}

/** todo is insufficient: a task returned to the board can still own a run and checkout. */
export async function assertTasksUnstarted(
  db: AppDb,
  dataDir: string,
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  ids: string[],
): Promise<void> {
  // ArtifactStore tolerates unavailable directories for display; writes must fail closed.
  await readdir(join(context.root, '.skaro', 'tasks'));
  for (const id of ids) {
    const task = artifacts.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`${id}: task no longer exists.`);
    const problem = unstartedTaskProblem(db, dataDir, context.id, task);
    if (problem) throw new Error(`${id}: ${problem}.`);
    // A failed launch can leave a branch before a RunRecord is written.
    const branch = taskBranch(artifacts.config, task);
    const found = await git(
      context.root,
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { allowFail: true },
    );
    if (found.code === 0) throw new Error(`${id}: an existing task branch prevents replanning.`);
    if (found.code !== 1) throw new Error(`${id}: unable to verify the absence of a task branch.`);
  }
}

export function assertReplanSnapshot(
  tasks: Task[],
  snapshot: { id: string; fingerprint: string }[],
): void {
  if (
    tasks.length !== snapshot.length ||
    snapshot.some((s) => {
      const task = tasks.find((t) => t.id === s.id);
      return !task || fingerprint(task) !== s.fingerprint;
    })
  )
    throw new Error(
      'The task graph changed after this proposal. Ask the agent to prepare a new replan.',
    );
}
