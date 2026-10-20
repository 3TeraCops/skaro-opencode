import { projectRecords } from './project-records';
import { MergeBlockedError } from '@skaro/core';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import type { CompletionHooks } from './completion-coordinator';
import { CompletionStore, criteriaRevision } from './completion-store';
import { publicationBlockers } from './completion-dependencies';
import type { ProjectContext } from './projects';
import { IntegrationPending } from './integration-model';

interface Actions {
  pending: (projectId: string) => boolean;
  run: (projectId: string, action: () => Promise<void>) => Promise<void>;
  reconcile: (context: ProjectContext) => Promise<void>;
  merge: (projectId: string, target: string) => Promise<unknown>;
}

/** The merge conflict of a task that went back to the agent of the task. */
export async function returnedToAgent(
  hooks: CompletionHooks,
  projectId: string,
  taskId: string,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof MergeBlockedError) || !error.check.blockers.includes('conflicts'))
    return false;
  return (await hooks.conflicted?.(projectId, taskId, error.check.conflicts)) === true;
}

/** Independent projects progress concurrently. Failed input is retried on change or restart. */
export class CompletionMonitor {
  private readonly attempts = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;
  private closed = false;
  private readonly dirty = new Set<string>();
  private readonly heads = new Map<string, string>();
  private lastHeadCheck = 0;
  private readonly hooks: CompletionHooks;
  private readonly actions: Actions;
  constructor(hooks: CompletionHooks, actions: Actions) {
    this.hooks = hooks;
    this.actions = actions;
  }

  start(): void {
    this.timer ??= setInterval(() => {
      void this.sweep();
    }, 1000);
    this.timer.unref();
    void (async () => {
      for await (const project of projectRecords(this.hooks.deps.db)) {
        if (this.closed) return;
        this.dirty.add(project.id);
      }
      if (!this.closed) void this.sweep();
    })();
    void this.sweep();
  }

  changed(projectId: string): void {
    this.dirty.add(projectId);
    if (this.timer && !this.closed) setImmediate(() => void this.sweep());
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }

  report(projectId: string, taskId: string | undefined, error: unknown): void {
    if (error instanceof IntegrationPending) return;
    const message = String(error);
    const store = new CompletionStore(this.hooks.deps.db, projectId);
    if (store.issues()[taskId ?? 'project'] === message) return;
    store.issue(taskId, message);
    this.hooks.failed(projectId, taskId, message);
  }

  private async sweep(): Promise<void> {
    if (this.sweeping || this.closed) return;
    this.sweeping = true;
    try {
      if (Date.now() - this.lastHeadCheck > 30_000) {
        this.lastHeadCheck = Date.now();
        for await (const project of projectRecords(this.hooks.deps.db)) {
          const head = await this.hooks.deps.projects
            .get(project.id)
            .git.head()
            .catch(() => '');
          if (this.heads.get(project.id) !== head) this.dirty.add(project.id);
          this.heads.set(project.id, head);
        }
      }
      await Promise.all(
        [...this.dirty].slice(0, 2).map(async (id) => {
          const project = this.hooks.deps.db.getProject(id);
          if (!project) {
            this.dirty.delete(id);
            return;
          }
          if (this.closed || this.actions.pending(project.id)) return;
          this.dirty.delete(project.id);
          await this.actions
            .run(project.id, async () => {
              const context = this.hooks.deps.projects.get(project.id);
              await this.actions.reconcile(context);
              new CompletionStore(this.hooks.deps.db, project.id).issue(undefined);
              if (this.hooks.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) !== true)
                return;
              // A candidate resolved before merges went per task publishes first: a merge
              // beside it would move the base it was verified on.
              if (
                this.hooks.integrations.deps.store
                  .all(project.id)
                  .some(
                    (op) =>
                      op.purpose === 'publication' &&
                      (op.worker || op.executor || (op.state === 'ready' && op.publish)),
                  )
              )
                return;
              const artifacts = await context.summary();
              const store = new CompletionStore(this.hooks.deps.db, project.id);
              // One conflict at a time: while the agent of a task resolves its conflict, the
              // other tasks wait and are merged onto what it hands back, as their cards say.
              const runtime = this.hooks.deps.db.getTaskRuntime(project.id);
              const conflicts = store.conflicts();
              const resolving = artifacts.tasks.some(
                (task) =>
                  task.status === 'in_progress' &&
                  conflicts.includes(task.id) &&
                  ['queued', 'running'].includes(runtime.get(task.id)?.state ?? ''),
              );
              if (resolving) return;
              // Every accepted task is merged on its own as soon as its inputs are merged.
              const targets = artifacts.tasks
                .filter((task) => task.status === 'review' && !task.archived)
                .filter(
                  (task) =>
                    !publicationBlockers(artifacts, [store.result(task.id) ?? { taskId: task.id }])
                      .length,
                )
                .map((task) => task.id);
              for (const target of targets) {
                if (this.closed) break;
                if (this.hooks.busy(project.id, target)) continue;
                const fingerprint = JSON.stringify([
                  await context.git.head(artifacts.config.baseBranch),
                  artifacts.config,
                  artifacts.tasks.map((task) => [
                    task.id,
                    task.status,
                    criteriaRevision(task),
                    store.result(task.id)?.head,
                  ]),
                ]);
                const attempt = `${project.id}.${target}`;
                if (this.attempts.get(attempt) === fingerprint) continue;
                this.attempts.set(attempt, fingerprint);
                try {
                  await this.actions.merge(project.id, target);
                } catch (error) {
                  if (await returnedToAgent(this.hooks, project.id, target, error)) break;
                  this.report(project.id, target, error);
                }
              }
            })
            .catch((error: unknown) => this.report(project.id, undefined, error));
        }),
      );
    } finally {
      this.sweeping = false;
      if (this.dirty.size && !this.closed) this.timer?.refresh();
    }
  }
}
