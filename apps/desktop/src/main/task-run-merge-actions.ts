import type { MergeAction } from '../shared/ipc';
import { git } from '@skaro/core';
import type { ProjectContext } from './projects';
import { type MergeInteraction } from './task-merge-card';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { subjectOf } from './task-subject';
import { CompletionStore } from './completion-store';
import { stageIdOf } from './task-stage';

/** mergeActions: a focused part of the task-run controller. */
export class TaskRunMergeActions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  async revert(projectId: string, taskId: string, commit: string): Promise<void> {
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    if (!active) throw new Error('The task has no run');
    await this.ctx.merges.revert(active, this.ctx.project(projectId), commit);
  }

  async merge(
    projectId: string,
    taskId: string,
    interactionId: string,
    action: MergeAction,
  ): Promise<void> {
    const active = this.ctx.requireActive(projectId, taskId);
    const card = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge' && i.id === interactionId,
    );
    if (!card) throw new Error('The merge card is closed');
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;

    switch (action.action) {
      case 'cancel':
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: card.id,
          resolution: 'cancelled',
        });
        this.ctx.events.settleRuntime(active);
        return;
      case 'update_branch': {
        if (active.timeline.state.status !== 'idle')
          throw new Error('Wait for the task agent to finish before updating its branch');
        if (stageIdOf(active.run))
          throw new Error(
            'A legacy shared branch must be updated by its task agent and resubmitted; Skaro preserves the other accepted results',
          );
        const result = await this.ctx.merges.coordinator.serialized(projectId, async () => {
          if ((await git(active.run.worktree!, ['status', '--porcelain'])).stdout.trim())
            throw new Error('Preserve uncommitted edits before updating the accepted branch');
          return context.git.rebase(active.run.worktree!, base);
        });
        if (result.ok) {
          const saved = new CompletionStore(this.ctx.deps.db, projectId).result(taskId);
          const task = await context.store.readTask(taskId);
          await this.ctx.merges.coordinator.capture(
            projectId,
            taskId,
            branch,
            active.run.worktree!,
            saved?.message ?? `${task.id}: ${task.title}`,
            saved?.summary,
          );
        }
        await this.ctx.merges.showCard(active, context, { partial: card.stage?.partial ?? false });
        return;
      }
      case 'resolve_with_agent': {
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: card.id,
          resolution: 'cancelled',
        });
        const files = card.conflicts.map((f) => `- ${f}`).join('\n');
        await this.ctx.messages.turn(active, {
          text:
            `Слияние ветки ${branch} в ${base} даёт конфликты:\n${files}\n\n` +
            `Перенеси ветку на свежую ${base} (git rebase ${base}), разреши конфликты, закоммить ` +
            `результат и снова вызови ${card.stage ? 'submit_result' : 'merge_task'}.`,
        });
        return;
      }
      case 'confirm': {
        // The messages of the card as the user left them go to the commits of the tasks.
        const messages = action.messages;
        if (card.stage && messages)
          card.stage = {
            ...card.stage,
            tasks: card.stage.tasks.map((t) => ({ ...t, message: messages[t.id] ?? t.message })),
          };
        await this.confirmMerge(active, context, card, action.message);
      }
    }
  }

  /**
   * "На ревью" → "Готово" on the board: merges with the task's open merge card and its message.
   * Without a card, or with a blocked one, the user decides in the task's feed.
   */
  async mergeFromBoard(projectId: string, taskId: string): Promise<'merged' | 'open'> {
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    const card = active?.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );
    if (!active || !card || card.blockers.length) return 'open';
    const context = this.ctx.project(projectId);
    const task = subjectOf(await context.load(), taskId);
    await this.confirmMerge(
      active,
      context,
      card,
      card.message ?? `${taskId}: ${task?.title ?? ''}`,
    );
    return 'merged';
  }

  confirmMerge(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ) {
    return this.ctx.merges.confirm(active, context, card, message);
  }
}
