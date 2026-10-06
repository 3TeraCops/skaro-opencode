import { AUTO_MERGE_KEY } from '../shared/ipc';
import type { CompletionHooks } from './completion-coordinator';
import { CompletionStore, criteriaRevision } from './completion-store';
import type { ProjectContext } from './projects';

interface Actions {
  pending: (projectId: string) => boolean;
  run: (projectId: string, action: () => Promise<void>) => Promise<void>;
  reconcile: (context: ProjectContext) => Promise<void>;
  merge: (projectId: string, target: string) => Promise<unknown>;
}

/** Independent projects progress concurrently. Failed input is retried on change or restart. */
export class CompletionMonitor {
  private readonly attempts = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;
  private closed = false;
  private readonly hooks: CompletionHooks;
  private readonly actions: Actions;
  constructor(hooks: CompletionHooks, actions: Actions) {
    this.hooks = hooks;
    this.actions = actions;
  }

  start(): void {
    this.timer ??= setInterval(() => {
      void this.sweep();
    }, 3000);
    this.timer.unref();
    void this.sweep();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }

  report(projectId: string, taskId: string | undefined, error: unknown): void {
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
      await Promise.all(
        this.hooks.deps.db.listProjects().map(async (project) => {
          if (this.closed || this.actions.pending(project.id)) return;
          await this.actions
            .run(project.id, async () => {
              const context = this.hooks.deps.projects.get(project.id);
              await this.actions.reconcile(context);
              new CompletionStore(this.hooks.deps.db, project.id).issue(undefined);
              if (this.hooks.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) !== true)
                return;
              const artifacts = await context.load();
              const targets = [
                ...new Set(
                  artifacts.tasks
                    .filter((task) => task.status === 'review' && !task.archived)
                    .filter(
                      (task) =>
                        !task.milestone ||
                        artifacts.tasks
                          .filter((other) => other.milestone === task.milestone && !other.archived)
                          .every((other) => ['review', 'done', 'cancelled'].includes(other.status)),
                    )
                    .map((task) => task.milestone ?? task.id),
                ),
              ];
              for (const target of targets) {
                if (this.closed) break;
                if (
                  artifacts.tasks.some(
                    (task) =>
                      (task.id === target || task.milestone === target) &&
                      this.hooks.busy(project.id, task.id),
                  )
                )
                  continue;
                const store = new CompletionStore(this.hooks.deps.db, project.id);
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
                await this.actions
                  .merge(project.id, target)
                  .catch((error: unknown) => this.report(project.id, target, error));
              }
            })
            .catch((error: unknown) => this.report(project.id, undefined, error));
        }),
      );
    } finally {
      this.sweeping = false;
    }
  }
}
