import type { StageInfo } from '../shared/ipc';
import { orderedStageTasks, stageInfo } from './stage-views';
import { key } from './task-run-helpers';
import type { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { readLedger, stageIdOf, writeLedger } from './task-stage';
import { AUTO_MERGE_KEY } from '../shared/ipc';

/** Milestones schedule tasks; they never create agent sessions or their own chats. */
export class TaskRunStages {
  private readonly units = new Map<string, string>();
  private readonly holders = new Map<string, string>();
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  /** Only previously created shared checkouts need mutual exclusion. */
  blocked(k: string): boolean {
    const unit = this.units.get(k);
    if (!unit) return false;
    const holder = this.holders.get(unit);
    return (
      (!!holder && holder !== k) ||
      this.ctx.queue.state().running.some((other) => other !== k && this.units.get(other) === unit)
    );
  }

  async sync(projectId: string, taskId: string): Promise<void> {
    const k = key(projectId, taskId);
    const artifacts = await this.ctx.project(projectId).load();
    const run = this.ctx.active.get(k)?.run ?? this.ctx.deps.db.listRuns(projectId, taskId)[0];
    const task = artifacts.tasks.find((item) => item.id === taskId);
    const inPlace =
      task &&
      (run
        ? !run.worktree
        : this.ctx.views.settings(projectId, task, artifacts).isolation !== 'worktree');
    const stageId = inPlace ? '__main__' : run && stageIdOf(run);
    if (!stageId) this.units.delete(k);
    else {
      const unit = key(projectId, stageId);
      this.units.set(k, unit);
      const holder = artifacts.tasks.find((task) => {
        const existing =
          this.ctx.active.get(key(projectId, task.id))?.run ??
          this.ctx.deps.db.listRuns(projectId, task.id)[0];
        return (
          existing &&
          (inPlace ? !existing.worktree : stageIdOf(existing) === stageId) &&
          (task.status === 'in_progress' || task.status === 'failed')
        );
      });
      if (holder) this.holders.set(unit, key(projectId, holder.id));
      else this.holders.delete(unit);
    }
    this.ctx.queue.poke();
  }

  /** Retain provenance for an unfinished task in a legacy shared checkout. */
  async opened(active: ActiveRun): Promise<void> {
    const stageId = stageIdOf(active.run);
    if (!stageId) return;
    const ledger = readLedger(this.ctx.deps.db, active.projectId, stageId);
    if (ledger.open[active.taskId]) return;
    ledger.open[active.taskId] = await this.ctx
      .project(active.projectId)
      .git.head('HEAD', active.run.worktree);
    writeLedger(this.ctx.deps.db, active.projectId, stageId, ledger);
  }

  async accept(projectId: string, stageId: string): Promise<void> {
    const context = this.ctx.project(projectId);
    context.invalidate();
    const tasks = orderedStageTasks({ id: stageId }, await context.load());
    if (!tasks.length || tasks.some((task) => !['review', 'done'].includes(task.status))) return;
    if (this.ctx.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true)
      await this.ctx.merges.coordinator.merge(projectId, stageId);
    else await this.mergeFinished(projectId, stageId);
  }

  async list(projectId: string): Promise<StageInfo[]> {
    const artifacts = await this.ctx.project(projectId).load();
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const awaiting = new Set(Object.keys(this.ctx.scheduling.awaiting(projectId)));
    return [...artifacts.milestones]
      .sort((a, b) => a.order - b.order)
      .map((stage) => stageInfo(stage, artifacts, runtime, { awaiting, accepted: false }));
  }

  async start(projectId: string, stageId: string, message: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const todo = orderedStageTasks({ id: stageId }, artifacts).filter(
      (task) => task.status === 'todo',
    );
    if (todo.length)
      await this.ctx.scheduling.launch(
        projectId,
        todo.map((task) => task.id),
        message,
      );
    else await this.accept(projectId, stageId);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  async stop(projectId: string, stageId: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const ids = orderedStageTasks({ id: stageId }, artifacts).map((task) => task.id);
    this.ctx.scheduling.forgetAwaiting(projectId, ids);
    for (const id of ids) await this.ctx.messages.interrupt(projectId, id);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  /** The existing merge card lives in an actual task chat. */
  async mergeFinished(projectId: string, stageId: string): Promise<void> {
    const context = this.ctx.project(projectId);
    const task = orderedStageTasks({ id: stageId }, await context.load()).findLast(
      (item) => item.status === 'review',
    );
    if (!task) throw new Error('No accepted results awaiting merge');
    const active =
      this.ctx.active.get(key(projectId, task.id)) ??
      (await this.ctx.history.restore(projectId, task.id));
    if (!active) throw new Error(`${task.id}: no task history; merge from the project chat`);
    await this.ctx.merges.showCard(active, context, { partial: true });
    this.ctx.changed(projectId, task.id);
  }
}
