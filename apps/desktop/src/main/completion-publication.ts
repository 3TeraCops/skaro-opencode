import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArtifactStore, git, type ProjectArtifacts } from '@skaro/core';
import type { ProjectContext } from './projects';
import { CompletionStore, criteriaRevision, type CompletionOperation } from './completion-store';
import { withCompletionCheckout } from './completion-checkout';
import { taskSections } from './task-body';
import { runChecks } from './check-runner';
import { assertResultUnchanged } from './completion-results';

/** Prepare, verify and publish a single commit, recording it before the Git ref moves. */
export async function publishCompletion(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  store: CompletionStore,
  operation: CompletionOperation,
  message: string,
): Promise<void> {
  const tasks = operation.results.map((result) => {
    const task = artifacts.tasks.find((item) => item.id === result.taskId);
    if (!task) throw new Error(`Task ${result.taskId} was removed`);
    return task;
  });
  await withCompletionCheckout(
    context.git,
    operation.base,
    operation.results,
    async (checkout, head) => {
      await context.git.merge({
        base: operation.base,
        branch: head,
        strategy: operation.strategy,
        worktree: checkout,
        message:
          operation.results.length > 1
            ? `${message.split('\n\n')[0]}\n\n${operation.results.map((result) => result.message).join('\n')}`
            : message,
        managedPaths: tasks.map((task) => task.path),
        guardPaths: [
          '.skaro/config.yaml',
          ...artifacts.specs
            .filter((spec) => tasks.some((task) => task.spec === spec.id))
            .map((spec) => spec.path),
        ],
        allowMetadataOnly: true,
        beforeCommit: async (candidate) => {
          const target = new ArtifactStore(candidate);
          for (const task of tasks) {
            const path = join(candidate, task.path);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, await readFile(join(context.root, task.path)));
            const current = await target.readTask(task.id);
            const result = operation.results.find((item) => item.taskId === task.id)!;
            if (
              current.status !== 'review' ||
              criteriaRevision(current) !== result.criteria ||
              taskSections(current.body).criteria.some((item) => !item.done)
            )
              throw new Error(`${task.id}: acceptance changed during merge`);
            await target.updateTask(task.id, { status: 'done' });
          }
          return tasks.map((task) => task.path);
        },
        verify: (candidate) => runChecks(candidate, artifacts.config.checks),
        prepared: async ({ before, commit }) => {
          for (const result of operation.results) {
            if (store.result(result.taskId)?.head !== result.head)
              throw new Error(`${result.taskId}: a newer result was submitted during verification`);
            await assertResultUnchanged(context, result);
          }
          // Protect the candidate from GC if the process dies before publishing it.
          await git(context.root, ['update-ref', `refs/skaro/completions/${operation.id}`, commit]);
          Object.assign(operation, { before, commit, state: 'prepared' });
          store.save(operation);
        },
      });
    },
  );
}
