import type { AppDb } from '@skaro/core';
import type { CiRunArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { Projects } from './projects';
import { gh, githubRepository, githubRun, type GithubRun } from './ci-github';

export interface TrackedCiRun {
  projectId: string;
  repository: string;
  runId: number;
  kind: CiRunArgs['kind'];
  scope: SkaroScope;
  remote?: GithubRun;
  infrastructureRetried?: boolean;
  retryFromAttempt?: number;
  retryRequestedAt?: number;
  error?: string;
}

/** CI/release lifecycle is independent of task completion and of the initiating agent turn. */
export class CiRuns {
  private readonly db: AppDb;
  private readonly projects: Projects;
  private readonly notify: (scope: SkaroScope, text: string, error: boolean) => Promise<void>;
  private readonly busy = new Map<string, Promise<unknown>>();
  private readonly timer: NodeJS.Timeout;
  private closed = false;

  constructor(
    db: AppDb,
    projects: Projects,
    notify: (scope: SkaroScope, text: string, error: boolean) => Promise<void>,
  ) {
    this.db = db;
    this.projects = projects;
    this.notify = notify;
    this.timer = setInterval(() => {
      void this.poll();
    }, 15_000);
    this.timer.unref();
    void this.poll();
  }

  async call(args: CiRunArgs, scope: SkaroScope): Promise<ToolResult> {
    if (scope.importId) return { text: 'Import sessions cannot track CI.', isError: true };
    return this.serialized(`${scope.projectId}.${args.runId}`, async () => {
      try {
        const root = this.projects.get(scope.projectId).root;
        const repository = await githubRepository(root);
        const old = this.records().find(
          (run) => run.projectId === scope.projectId && run.runId === args.runId,
        );
        const run: TrackedCiRun = old ?? {
          projectId: scope.projectId,
          repository,
          runId: args.runId,
          kind: args.kind,
          scope,
        };
        if (run.repository !== repository)
          throw new Error(
            'The project origin changed; the tracked run belongs to another repository',
          );
        run.remote = await githubRun(root, repository, args.runId);
        if (run.retryFromAttempt === undefined || run.remote.run_attempt > run.retryFromAttempt)
          delete run.error;
        if (args.action === 'retry_failed') {
          try {
            await this.retry(run);
          } catch (error) {
            run.error = String(error);
            this.save(run);
            throw error;
          }
        }
        this.save(run);
        let logs = '';
        if (run.remote.status === 'completed' && run.remote.conclusion !== 'success')
          logs = await gh(root, [
            'run',
            'view',
            String(args.runId),
            '--repo',
            repository,
            '--log-failed',
          ])
            .then((text) => text.slice(-16_000))
            .catch((error: unknown) => `Logs unavailable: ${String(error)}`);
        return { text: JSON.stringify({ ...run, logs }), ...(run.error ? { isError: true } : {}) };
      } catch (error) {
        return { text: String(error), isError: true };
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.busy.values());
  }

  private records(): TrackedCiRun[] {
    return this.db.getSetting<TrackedCiRun[]>('ci.runs', []);
  }
  private save(run: TrackedCiRun): void {
    this.db.setSetting('ci.runs', [
      ...this.records().filter(
        (item) => item.projectId !== run.projectId || item.runId !== run.runId,
      ),
      run,
    ]);
  }

  private async serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.busy.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.busy.set(key, next);
    try {
      return await next;
    } finally {
      if (this.busy.get(key) === next) this.busy.delete(key);
    }
  }

  private async retry(run: TrackedCiRun): Promise<void> {
    const remote = run.remote!;
    if (remote.status !== 'completed' || remote.conclusion === 'success')
      throw new Error('Only a completed unsuccessful workflow can be retried');
    if (run.retryFromAttempt !== undefined && remote.run_attempt <= run.retryFromAttempt)
      throw new Error(
        'A retry of this attempt was already requested. Check GitHub before requesting another.',
      );
    // Save before the remote side effect. A crash must never submit a duplicate rerun.
    run.retryFromAttempt = remote.run_attempt;
    run.retryRequestedAt = Date.now();
    this.save(run);
    await gh(this.projects.get(run.projectId).root, [
      'run',
      'rerun',
      String(run.runId),
      '--repo',
      run.repository,
      '--failed',
    ]);
    delete run.error;
    this.save(run);
  }

  private async poll(): Promise<void> {
    if (this.closed) return;
    await Promise.all(
      this.records()
        .filter(
          (run) =>
            run.error !== undefined ||
            run.remote?.status !== 'completed' ||
            run.retryFromAttempt === run.remote?.run_attempt ||
            (run.remote?.conclusion === 'startup_failure' && !run.infrastructureRetried),
        )
        .map(async (run) => {
          const key = `${run.projectId}.${run.runId}`;
          if (this.busy.has(key) || this.closed) return;
          await this.serialized(key, async () => {
            try {
              const root = this.projects.get(run.projectId).root;
              if ((await githubRepository(root)) !== run.repository)
                throw new Error('Project origin changed');
              const remote = await githubRun(root, run.repository, run.runId);
              const changed = JSON.stringify(remote) !== JSON.stringify(run.remote);
              run.remote = remote;
              if (run.retryFromAttempt === undefined || remote.run_attempt > run.retryFromAttempt)
                delete run.error;
              else if (
                remote.status === 'completed' &&
                run.retryRequestedAt &&
                Date.now() - run.retryRequestedAt > 60_000 &&
                !run.error
              ) {
                run.error =
                  'Retry requested but no new attempt is visible yet. Inspect GitHub; the request will not be duplicated.';
                await this.notify(run.scope, `${run.kind}: ${run.error}`, true);
              }
              if (
                remote.conclusion === 'startup_failure' &&
                !run.infrastructureRetried &&
                !run.retryFromAttempt
              ) {
                run.infrastructureRetried = true;
                await this.retry(run);
              }
              this.save(run);
              if (changed)
                await this.notify(
                  run.scope,
                  `${run.kind}: ${remote.status} / ${remote.conclusion ?? 'pending'}\n${remote.html_url}`,
                  remote.status === 'completed' && remote.conclusion !== 'success',
                );
            } catch (error) {
              const message = String(error);
              const changed = run.error !== message;
              run.error = message;
              this.save(run);
              if (changed) await this.notify(run.scope, `${run.kind}: ${message}`, true);
            }
          }).catch((error: unknown) => console.error(`CI notification: ${String(error)}`));
        }),
    );
  }
}
