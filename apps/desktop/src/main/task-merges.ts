import { randomUUID } from 'node:crypto';
import { MergeBlockedError } from '@skaro/core';
import type { MergeTaskArgs } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import type { ActiveRun, TaskRunDeps } from './tasks';
import { mergeInteraction, withStage, type MergeInteraction } from './task-merge-card';
import type { TaskMergeHooks } from './task-merge-refresh';
import { MergeCardRefresh } from './task-merge-refresh';
import { closeMergeCards, completedTaskReply, mergedTaskReply } from './task-merge-result';
import { undoTaskMerge } from './task-merge-undo';
import { CompletionCoordinator } from './completion-coordinator';
import { CompletionStore } from './completion-store';
import { acceptedResult } from './completion-results';
import { withCompletionCheckout } from './completion-checkout';
import { projectCompletion } from './completion-feed';

/** Chat adapter. All sources of a merge use the same durable coordinator. */
export class TaskMerges {
  readonly coordinator: CompletionCoordinator;
  private readonly refresh: MergeCardRefresh;
  private readonly fingerprints = new Map<string, string>();
  private readonly hooks: TaskMergeHooks & { deps: TaskRunDeps };
  constructor(hooks: TaskMergeHooks & { deps: TaskRunDeps }) {
    this.hooks = hooks;
    this.refresh = new MergeCardRefresh({
      ...hooks,
      refreshCard: async (active, card) => {
        const context = hooks.project(active.projectId);
        const artifacts = await context.load();
        if (artifacts.tasks.find((task) => task.id === active.taskId)?.status === 'done') {
          closeMergeCards(active, hooks);
          return;
        }
        const fingerprint = JSON.stringify([
          await context.git.head(artifacts.config.baseBranch),
          artifacts.tasks.map((task) => [task.id, task.status, task.body]),
          new CompletionStore(hooks.deps.db, active.projectId).operations().at(-1),
        ]);
        if (this.fingerprints.get(active.run.id) === fingerprint) return;
        await this.showCard(active, context, { partial: card.stage?.partial ?? false });
        this.fingerprints.set(active.run.id, fingerprint);
      },
    });
    this.coordinator = new CompletionCoordinator({
      deps: hooks.deps,
      busy: (projectId, taskId) =>
        hooks
          .active()
          .some(
            (run) =>
              run.projectId === projectId &&
              run.taskId === taskId &&
              (!!run.switching || run.timeline.state.status === 'working'),
          ),
      completed: (projectId, operation, unblocked) =>
        projectCompletion(hooks, projectId, operation, unblocked),
      failed: (projectId, taskId, error) => {
        hooks.deps.db.addEvent(projectId, 'completion_failed', { taskId, error });
        hooks.deps.emit('project.changed', { projectId });
        hooks.deps.notify?.('error', error);
        const active = hooks
          .active()
          .find((run) => run.projectId === projectId && run.taskId === taskId);
        if (active)
          hooks.skaroEvent(active, {
            t: 'item.upsert',
            item: {
              id: `skaro-completion-error-${projectId}`,
              turnId: active.timeline.state.turns.at(-1)?.id ?? '',
              kind: 'notice',
              level: 'error',
              code: 'other',
              text: error,
              status: 'done',
              startedAt: Date.now(),
              native: { agent: 'skaro', type: 'completion_failed', ref: projectId },
            },
          });
        console.error(`Completion ${projectId}: ${error}`);
      },
    });
  }

  start(): void {
    this.coordinator.start();
  }
  watch(active: ActiveRun): void {
    if (active.merged) closeMergeCards(active, this.hooks);
    else this.refresh.watch(active);
  }
  close(): Promise<void> {
    this.refresh.close();
    return this.coordinator.close();
  }
  async idle(projectId: string): Promise<void> {
    await this.coordinator.idle(projectId);
  }

  revert(active: ActiveRun, context: ProjectContext, commit: string): Promise<string> {
    return this.coordinator.serialized(active.projectId, () =>
      undoTaskMerge(active, context, commit, this.hooks),
    );
  }

  async request(args: MergeTaskArgs, active: ActiveRun, context: ProjectContext) {
    if (args.summary) active.mergeSummary = args.summary;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const task = await context.store.readTask(active.taskId);
    if (task.status === 'done' && !args.milestoneId) {
      closeMergeCards(active, this.hooks);
      return {
        text: completedTaskReply(
          active,
          (await context.load()).config.baseBranch,
          this.hooks.deps.db,
        ),
      };
    }
    if (task.status !== 'done' && task.status !== 'review') {
      if (!active.run.branch || !active.run.worktree)
        throw new Error('The task has no result branch');
      await this.coordinator.capture(
        active.projectId,
        active.taskId,
        active.run.branch,
        active.run.worktree,
        active.commitMessage ?? `${task.id}: ${task.title}`,
        active.mergeSummary,
      );
    }
    const result = await this.coordinator.merge(
      active.projectId,
      args.milestoneId ?? active.taskId,
      args.partial ?? false,
      args.commitMessage,
    );
    active.merged = result;
    return { text: mergedTaskReply(result) };
  }

  showCard(active: ActiveRun, context: ProjectContext, options: { partial?: boolean } = {}) {
    return this.coordinator.serialized(
      active.projectId,
      async (): Promise<MergeInteraction | undefined> => {
        context.invalidate();
        const artifacts = await context.load();
        const task = artifacts.tasks.find((item) => item.id === active.taskId);
        if (!task) throw new Error('The task no longer exists');
        if (task.status === 'done') {
          closeMergeCards(active, this.hooks);
          return undefined;
        }
        const stage = artifacts.milestones.find((item) => item.id === task.milestone);
        const tasks = stage
          ? artifacts.tasks.filter(
              (item) => item.milestone === stage.id && !item.archived && item.status === 'review',
            )
          : [task];
        const results = [];
        for (const item of tasks)
          results.push(await acceptedResult(this.hooks.deps.db, context, item));
        if (!results.length) throw new Error('No accepted results awaiting merge');
        const check = await withCompletionCheckout(
          context.git,
          artifacts.config.baseBranch,
          results,
          (_checkout, head) => context.git.checkMerge(artifacts.config.baseBranch, head),
        ).catch((error: unknown) => {
          if (error instanceof MergeBlockedError) return error.check;
          throw error;
        });
        check.blockers = check.blockers.filter((blocker) => blocker !== 'no_changes');
        const previous = active.timeline.state.interactions.find((item) => item.kind === 'merge');
        const card = mergeInteraction(
          previous?.id ?? randomUUID(),
          stage?.id ?? results[0]!.branch,
          artifacts.config.baseBranch,
          check,
        );
        if (stage)
          withStage(card, {
            id: stage.id,
            partial: options.partial ?? false,
            unmet: [],
            tasks: results.map((result) => ({
              id: result.taskId,
              title: tasks.find((item) => item.id === result.taskId)!.title,
              message:
                previous?.kind === 'merge'
                  ? (previous.stage?.tasks.find((item) => item.id === result.taskId)?.message ??
                    result.message)
                  : result.message,
            })),
          });
        else
          card.message =
            previous?.kind === 'merge'
              ? (previous.message ?? active.commitMessage ?? results[0]!.message)
              : (active.commitMessage ?? results[0]!.message);
        this.hooks.skaroEvent(active, { t: 'interaction.opened', interaction: card });
        this.hooks.settleRuntime(active);
        this.watch(active);
        return card;
      },
    );
  }

  async confirm(
    active: ActiveRun,
    _context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ) {
    if (active.switching) throw new Error('The agent is being changed; retry after the handoff');
    if (card?.stage) {
      const store = new CompletionStore(this.hooks.deps.db, active.projectId);
      for (const task of card.stage.tasks) {
        const result = store.result(task.id);
        if (result) store.saveResult({ ...result, message: task.message });
      }
    }
    const result = await this.coordinator.merge(
      active.projectId,
      card?.stage?.id ?? active.taskId,
      card?.stage?.partial ?? false,
      message || undefined,
    );
    active.merged = result;
    return result;
  }
}

export function lastAgentText(active: ActiveRun): string | undefined {
  for (const item of [...active.timeline.state.items].reverse()) {
    if (item.kind === 'message' && item.role === 'agent' && !item.parentId && item.text.trim())
      return item.text.trim();
  }
  return undefined;
}
