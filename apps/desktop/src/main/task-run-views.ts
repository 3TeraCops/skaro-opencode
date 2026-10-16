import { currentActivity } from '@skaro/timeline';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { indexTasks, type ProjectArtifacts, type RunRecord, type Task } from '@skaro/core';
import type { AgentId, AgentSettings, TaskAssignment, TaskSummary, TaskView } from '../shared/ipc';
import { toggleCriterion } from './task-body';
import {
  key,
  settingsKey,
  awaitingKey,
  findTask,
  ref,
  runInfo,
  summary,
  detail,
} from './task-run-helpers';
import type { TaskRunEngine } from './task-run-engine';
import { orderedStageTasks, stageInfo } from './stage-views';
import { waitsInStage } from './task-stage-waits';
import { subjectStage } from './task-subject';
import { readSubject, updateSubject } from './task-subject';
import { trackRun } from './task-run-access';
import { withAgentDefaults } from './agent-model-defaults';
import { taskAgentPreferences, type TaskAgentPreferences } from './task-agent-preferences';
import { taskRunDirectory } from './task-run-directory';
import {
  IntegrationFailed,
  IntegrationPending,
  integrationCandidate,
  integrationWorking,
} from './integration-model';
import { taskMergeStates } from './task-merge-state';

/** views: a focused part of the task-run controller. */
export class TaskRunViews {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async list(projectId: string): Promise<TaskSummary[]> {
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const index = indexTasks(artifacts.tasks);
    const runs = this.ctx.deps.db.listRuns(projectId);
    const merges = taskMergeStates(this.ctx, projectId, artifacts);
    return Promise.all(
      artifacts.tasks.map(async (task) => {
        const run = runs.find((r) => r.taskId === task.id);
        const file = await stat(join(context.root, task.path)).catch(() => undefined);
        const updatedAt = Math.max(file?.mtimeMs ?? 0, run?.endedAt ?? run?.startedAt ?? 0);
        const state = runtime.get(task.id)?.state;
        const result = summary(task, artifacts, index, state, {
          ...this.assigned(projectId, task, run, artifacts),
          updatedAt,
        });
        const active = this.ctx.active.get(key(projectId, task.id));
        if (result.status === 'in_progress' && active)
          result.activity = currentActivity(active.timeline.state);
        // The card of the task says how its merge stands and what it waits for.
        const merging = merges.get(task.id);
        if (merging) result.merge = merging.merge;
        if (merging?.mergeAfter) result.mergeAfter = merging.mergeAfter;
        if (merging?.merge === 'running' && merging.operation)
          result.activity = await this.ctx.integrations.history.activity(merging.operation);
        return { ...result, ...waitsInStage(this.ctx, projectId, task, artifacts, runtime) };
      }),
    );
  }

  assigned(
    projectId: string,
    task: Task,
    run: RunRecord | undefined,
    artifacts: ProjectArtifacts,
  ): { agent?: AgentId; model?: string } {
    const saved = this.ctx.deps.db.getSetting<TaskAgentPreferences | null>(
      settingsKey(projectId, task.id),
      null,
    );
    if (saved?.followProject && !run) return taskAgentPreferences(artifacts.config, task, saved);
    const agent = saved?.agent ?? run?.agent ?? task.agent;
    if (agent !== 'claude-code' && agent !== 'codex') return {};
    const model = saved?.model ?? run?.model ?? task.model;
    return { agent, ...(model ? { model } : {}) };
  }

  async open(projectId: string, taskId: string): Promise<TaskView> {
    let active = await this.ctx.history.restore(projectId, taskId);
    const artifacts = await this.ctx.project(projectId).load();
    const task = findTask(artifacts, taskId);
    if (active) active = await this.ctx.handoff.recover(active, false);
    if (active) {
      if (task.status === 'done') this.ctx.results.closeMergeCard(active, 'answered');
      else {
        // A finished task is merged on its own: its milestone only groups it on the plan.
        const ready = task.status === 'review';
        if (ready && !active.timeline.state.interactions.some((item) => item.kind === 'merge')) {
          try {
            await this.ctx.merges.showCard(active, this.ctx.project(projectId));
          } catch (error) {
            // Opening the task repeats the saved failure of its candidate; it is not a new error.
            if (!(error instanceof IntegrationPending) && !(error instanceof IntegrationFailed))
              this.ctx.history.notice(active, 'other', 'error', String(error));
          }
        }
        this.ctx.merges.watch(active);
      }
    }
    const runtime = this.ctx.deps.db.getTaskRuntime(projectId);
    const settings = this.settings(projectId, task, artifacts);
    const sandbox = this.ctx.deps.db.getSetting<{ holds?: boolean } | null>(
      `agents.${settings.agent}.sandbox`,
      null,
    );
    const stage = subjectStage(artifacts, taskId);
    const index = indexTasks(artifacts.tasks);
    const shown = detail(task, artifacts, runtime, active?.run);
    const integration = await this.ctx.integrations.history.project(
      projectId,
      taskId,
      active?.timeline.state,
    );
    const integrations = this.ctx.integrations.store.all(projectId);
    return {
      projectId,
      environmentReview: this.ctx.reviews.state(projectId, taskId),
      task: shown,
      ...(stage
        ? {
            stage: {
              info: stageInfo(stage, artifacts, runtime, {
                awaiting: new Set(Object.keys(this.ctx.scheduling.awaiting(projectId))),
                accepted: this.ctx.deps.db.listRuns(projectId, stage.id).length > 0,
                integrations,
              }),
              tasks: orderedStageTasks(stage, artifacts).map((t) =>
                ref(t, index, runtime.get(t.id)?.state),
              ),
            },
          }
        : {}),
      settings,
      ...(active ? { run: runInfo(active) } : {}),
      timeline: integration.timeline,
      timelineRevision: integration.revision,
      timelineSources: integration.sources,
      executionWorktree: integrationCandidate(integrations, taskId)?.worktree,
      error: shown.status === 'failed' ? this.ctx.startup.error(projectId, taskId) : undefined,
      seq: active?.seq ?? 0,
      ...waitsInStage(this.ctx, projectId, task, artifacts, runtime),
      queued: this.ctx.queue.state().queued.includes(key(projectId, taskId)),
      slotsFree: this.ctx.queue.state().running.length < this.ctx.queue.state().slots,
      agentSwitchBlocked:
        integrationWorking(integrations, taskId) ||
        (!!active &&
          (this.ctx.handoff.changing(active) ||
            !!active.attaching ||
            !!active.afterTurn ||
            active.timeline.state.status === 'working')),
      ...(sandbox?.holds !== undefined ? { sandboxHolds: sandbox.holds } : {}),
    };
  }

  workdir(projectId: string, taskId: string): string {
    const integration = integrationCandidate(this.ctx.integrations.store.all(projectId), taskId);
    if (integration) return integration.worktree;
    const active = this.ctx.active.get(key(projectId, taskId));
    const run = active
      ? this.ctx.deps.db.getRun(active.run.id)
      : this.ctx.deps.db.listRuns(projectId, taskId)[0];
    const root = this.ctx.project(projectId).root;
    if (run?.retiredAt !== undefined) throw new Error('The run belongs to a deleted task.');
    return run ? taskRunDirectory(root, run) : root;
  }

  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    const saved = this.ctx.deps.db.getSetting<TaskAgentPreferences | null>(
      settingsKey(projectId, task.id),
      null,
    );
    const active = this.ctx.active.get(key(projectId, task.id));
    const preferences = taskAgentPreferences(
      artifacts.config,
      task,
      saved,
      active
        ? {
            agent: active.run.agent,
            model: active.timeline.state.session?.model || active.run.model,
          }
        : undefined,
    );
    const configured = preferences.agent;
    // A started task keeps its agent; a new one goes to a ready agent if its own is absent.
    const started = this.ctx.active.has(key(projectId, task.id));
    const agent =
      saved?.agent || started ? configured : this.ctx.deps.agents.readyAgent(configured);
    const { model, effort } = preferences;
    return {
      agent: agent === 'codex' ? 'codex' : 'claude-code',
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      permissionMode: saved?.permissionMode ?? artifacts.config.permissionMode,
      planFirst: saved?.planFirst ?? false,
      isolation: saved?.isolation ?? artifacts.config.isolation,
    };
  }

  async assign(projectId: string, taskId: string, assignment: TaskAssignment): Promise<void> {
    if (this.ctx.active.has(key(projectId, taskId))) return;
    const artifacts = await this.ctx.project(projectId).load();
    const current = this.settings(projectId, findTask(artifacts, taskId), artifacts);
    const { model: _model, effort: _effort, ...rest } = current;
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), {
      ...rest,
      agent: assignment.agent,
      ...(assignment.model ? { model: assignment.model } : {}),
      ...(assignment.effort ? { effort: assignment.effort } : {}),
    });
    this.ctx.changed(projectId, taskId);
  }

  async toggleCriterion(projectId: string, taskId: string, index: number): Promise<void> {
    const context = this.ctx.project(projectId);
    const task = await readSubject(context, taskId);
    await updateSubject(context, taskId, { body: toggleCriterion(task.body, index) });
    this.ctx.changed(projectId, taskId);
    await this.ctx.results.criteriaChanged(projectId, taskId);
  }

  async setSettings(projectId: string, taskId: string, next: AgentSettings): Promise<void> {
    if (integrationWorking(this.ctx.integrations.store.all(projectId), taskId))
      throw new Error('Stop the integration turn before changing its agent settings.');
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    const artifacts = await this.ctx.project(projectId).load();
    const task = findTask(artifacts, taskId);
    const before = this.settings(projectId, task, artifacts);
    if (active && next.isolation !== before.isolation)
      throw new Error('Keep the existing isolation of a started task.');
    if (active && (next.agent !== active.run.agent || active.switching)) {
      await this.ctx.handoff.change(active, next);
      return;
    }
    if (active?.switching) throw new Error('The agent is being changed. Retry after the handoff.');
    const session = active?.session;
    if (session) {
      await trackRun(active, async () => {
        if (next.model && (next.model !== before.model || next.effort !== before.effort))
          await session.setModel(next.model, next.effort);
        if (next.permissionMode !== before.permissionMode)
          await session.setPermissionMode(next.permissionMode);
      });
    }
    this.ctx.deps.db.setSetting(settingsKey(projectId, taskId), next);
    this.ctx.changed(projectId, taskId);
  }

  async withDefaults(agent: AgentId, cwd: string, settings: AgentSettings): Promise<AgentSettings> {
    return withAgentDefaults(this.ctx.deps.agents, agent, cwd, settings);
  }

  /** Changing project defaults updates every unstarted task, including stage/slot waits. */
  async followProjectDefaults(projectId: string): Promise<void> {
    const artifacts = await this.ctx.project(projectId).load();
    const started = new Set(this.ctx.deps.db.listRuns(projectId).map((r) => r.taskId));
    const awaiting = this.ctx.scheduling.awaiting(projectId);
    for (const task of artifacts.tasks) {
      if (
        task.status !== 'todo' ||
        started.has(task.id) ||
        this.ctx.active.has(key(projectId, task.id))
      )
        continue;
      const setting = settingsKey(projectId, task.id);
      const saved = this.ctx.deps.db.getSetting<TaskAgentPreferences | null>(setting, null);
      const { agent: _agent, model: _model, effort: _effort, ...rest } = saved ?? {};
      this.ctx.deps.db.setSetting(setting, { ...rest, followProject: true });
      if (awaiting[task.id]) delete awaiting[task.id]!.assignment;
    }
    this.ctx.deps.db.setSetting(awaitingKey(projectId), awaiting);
  }

  async ensureAgent(agent: AgentId): Promise<void> {
    await this.ctx.deps.agents.requireReady(agent);
  }
}
