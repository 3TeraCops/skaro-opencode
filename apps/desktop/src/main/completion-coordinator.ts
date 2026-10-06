import { git } from '@skaro/core';
import { CompletionMonitor } from './completion-monitor';
import type { TaskRunDeps } from './task-run-model';
import {
  CompletionStore,
  criteriaRevision,
  type CompletionOperation,
  type TaskResult,
} from './completion-store';
import { acceptedResult, assertResultUnchanged } from './completion-results';
import { publishCompletion } from './completion-publication';
import { finishCompletion } from './completion-projection';
import { reconcileCompletions } from './completion-recovery';
import { taskSections, withSummary } from './task-body';
import type { ProjectContext } from './projects';
import { stageIdOf } from './task-stage';

export interface CompletionHooks {
  deps: Pick<TaskRunDeps, 'db' | 'projects' | 'emit'>;
  busy: (projectId: string, taskId: string) => boolean;
  completed: (
    projectId: string,
    operation: CompletionOperation,
    unblocked: string[],
  ) => Promise<void>;
  failed: (projectId: string, taskId: string | undefined, error: string) => void;
}

/** Owns execution facts and publication. It never needs a chat, agent session or timeline. */
export class CompletionCoordinator {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly monitor: CompletionMonitor;
  private closed = false;
  private readonly hooks: CompletionHooks;
  constructor(hooks: CompletionHooks) {
    this.hooks = {
      ...hooks,
      busy: (projectId, taskId) =>
        this.pending.has(`${projectId}\n${taskId}`) || hooks.busy(projectId, taskId),
    };
    this.monitor = new CompletionMonitor(this.hooks, {
      pending: (projectId) =>
        [...this.pending.keys()].some(
          (key) => key === projectId || key.startsWith(`${projectId}\n`),
        ),
      run: (projectId, action) => this.serialized(projectId, action),
      reconcile: (context) =>
        reconcileCompletions(context, this.hooks, (projectId, taskId, error) =>
          this.monitor.report(projectId, taskId, error),
        ),
      merge: (projectId, target) => this.performMerge(projectId, target, false),
    });
  }

  start(): void {
    this.monitor.start();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.monitor.close();
    await Promise.allSettled(this.pending.values());
  }

  idle(projectId: string): Promise<unknown> {
    return Promise.all(
      [...this.pending]
        .filter(([key]) => key === projectId || key.startsWith(`${projectId}\n`))
        .map(([, pending]) => pending),
    );
  }

  async serialized<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Completion service is closing');
    const previous = this.pending.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.pending.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(projectId) === next) this.pending.delete(projectId);
    }
  }

  capture(
    projectId: string,
    taskId: string,
    branch: string,
    worktree: string,
    message: string,
    summary?: string,
  ): Promise<void> {
    return this.serialized(`${projectId}\n${taskId}`, async () => {
      const context = this.hooks.deps.projects.get(projectId);
      context.invalidate();
      const task = await context.store.readTask(taskId);
      if (task.status === 'done') return;
      if (taskSections(task.body).criteria.some((criterion) => !criterion.done))
        throw new Error(`${taskId}: acceptance criteria are unfinished`);
      await context.git.commitAll(worktree, message);
      const head = await context.git.head('HEAD', worktree);
      const store = new CompletionStore(this.hooks.deps.db, projectId);
      const result: TaskResult = {
        taskId,
        branch,
        worktree,
        sharedCheckout: !!stageIdOf({ projectId, taskId, worktree }),
        head,
        message,
        criteria: criteriaRevision(task),
        ...(summary ? { summary } : {}),
        pendingReview: true,
      };
      await git(context.root, ['update-ref', `refs/skaro/results/${taskId}/${head}`, head]);
      store.saveResult(result);
      await context.store.updateTask(taskId, {
        status: 'review',
        ...(!task.branch && !result.sharedCheckout ? { branch } : {}),
        ...(summary ? { body: withSummary(task.body, summary) } : {}),
      });
      store.saveResult({ ...result, pendingReview: false });
      store.issue(taskId);
      context.invalidate();
      this.hooks.deps.emit('project.changed', { projectId });
    });
  }

  merge(projectId: string, target: string, partial = false, message?: string) {
    return this.serialized(projectId, async () => {
      await Promise.all(
        [...this.pending]
          .filter(([key]) => key.startsWith(`${projectId}\n`))
          .map(([, pending]) => pending),
      );
      return this.performMerge(projectId, target, partial, message);
    });
  }

  private async performMerge(
    projectId: string,
    target: string,
    partial: boolean,
    message?: string,
  ) {
    const context = this.hooks.deps.projects.get(projectId);
    await this.reconcile(context);
    context.invalidate();
    const artifacts = await context.load();
    const configProblems = artifacts.problems.filter(
      (problem) => problem.path === '.skaro/config.yaml',
    );
    if (configProblems.length)
      throw new Error(configProblems.map((problem) => problem.message).join('\n'));
    const task = artifacts.tasks.find((item) => item.id === target);
    const stage = artifacts.milestones.find((item) => item.id === (task?.milestone ?? target));
    const scope = stage
      ? artifacts.tasks.filter(
          (item) => item.milestone === stage.id && !item.archived && item.status !== 'cancelled',
        )
      : task
        ? [task]
        : [];
    if (!scope.length) throw new Error(`No tasks to merge: ${target}`);
    if (!partial && scope.some((item) => !['review', 'done'].includes(item.status)))
      throw new Error(`${target}: not every task has an accepted result`);
    const tasks = scope.filter((item) => item.status === 'review');
    const store = new CompletionStore(this.hooks.deps.db, projectId);
    if (!tasks.length) {
      const completed = store
        .operations()
        .findLast(
          (op) =>
            op.state === 'completed' &&
            op.results.some((result) => scope.some((item) => item.id === result.taskId)),
        );
      if (completed?.commit) return { commit: completed.commit, base: completed.base };
      throw new Error(`${target}: no accepted results awaiting merge`);
    }
    const results: TaskResult[] = [];
    for (const item of tasks) results.push(await acceptedResult(this.hooks.deps.db, context, item));
    for (const result of results) {
      if (this.reverted(store, result))
        throw new Error(`${result.taskId}: merge was reverted; submit a revised result`);
      await assertResultUnchanged(context, result);
    }
    const operation = store.create(
      artifacts.config.baseBranch,
      results,
      artifacts.config.merge.strategy,
    );
    try {
      await publishCompletion(
        context,
        artifacts,
        store,
        operation,
        message?.trim() ||
          (stage
            ? `${stage.id}: ${stage.title}\n\n${results.map((r) => r.message).join('\n')}`
            : results[0]!.message),
      );
      await finishCompletion(this.hooks, context, store, operation);
      return { commit: operation.commit!, base: operation.base };
    } catch (error) {
      // A published candidate must be projected even if a later notification failed.
      operation.error = String(error);
      if (operation.state !== 'completed') operation.state = 'failed';
      store.save(operation);
      throw error;
    }
  }

  private reverted(store: CompletionStore, result: TaskResult): boolean {
    return store
      .operations()
      .some(
        (op) =>
          op.state === 'reverted' &&
          op.results.some((item) => item.taskId === result.taskId && item.head === result.head),
      );
  }

  private reconcile(context: ProjectContext): Promise<void> {
    return reconcileCompletions(context, this.hooks, (projectId, taskId, error) =>
      this.monitor.report(projectId, taskId, error),
    );
  }
}
