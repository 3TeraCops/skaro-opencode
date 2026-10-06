import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AppDb, ArtifactStore, git, type Task } from '@skaro/core';
import { Projects } from './projects';
import { CompletionCoordinator, type CompletionHooks } from './completion-coordinator';
import { CompletionStore, type CompletionOperation } from './completion-store';
import { reconcileCompletions } from './completion-recovery';

/** Owner-authorized real Git/SQLite fixtures. No agent, HTTP server or backend replacement. */
export class CompletionFixture {
  readonly root: string;
  readonly repo: string;
  db: AppDb;
  projects: Projects;
  readonly projectId: string;
  coordinator: CompletionCoordinator;
  completed: CompletionOperation[] = [];
  errors: string[] = [];

  private constructor(root: string, db: AppDb, projectId: string) {
    this.root = root;
    this.repo = join(root, 'repo');
    this.db = db;
    this.projectId = projectId;
    this.projects = new Projects(db, () => undefined);
    this.coordinator = new CompletionCoordinator(this.hooks());
  }

  static async create(): Promise<CompletionFixture> {
    const root = await mkdtemp(join(tmpdir(), 'skaro-completion-test-'));
    const repo = join(root, 'repo');
    await mkdir(repo);
    await git(repo, ['init', '-qb', 'main']);
    for (const [key, value] of [
      ['user.name', 'Completion test'],
      ['user.email', 'completion@skaro.dev'],
      ['commit.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
    ])
      await git(repo, ['config', key!, value!]);
    await writeFile(join(repo, 'README.md'), 'initial\n');
    await writeFile(join(repo, '.gitignore'), 'data/\n');
    const store = new ArtifactStore(repo);
    await store.writeConfig((await store.load()).config);
    const db = AppDb.open(join(root, 'app.sqlite'));
    const projectId = db.addProject({ name: 'Completion test', path: repo }).id;
    return new CompletionFixture(root, db, projectId);
  }

  get context() {
    return this.projects.get(this.projectId);
  }
  get journal() {
    return new CompletionStore(this.db, this.projectId);
  }

  hooks(): CompletionHooks {
    return {
      deps: { db: this.db, projects: this.projects, emit: () => undefined },
      busy: () => false,
      completed: async (_project, operation) => {
        this.completed.push(operation);
      },
      failed: (_project, _task, error) => this.errors.push(error),
    };
  }

  async task(title: string, milestone?: string, dependsOn: string[] = []): Promise<Task> {
    const task = await this.context.store.createTask({
      title,
      milestone,
      dependsOn,
      body: '## Критерии приёмки\n\n- [x] Accepted result\n',
    });
    const updated = await this.context.store.updateTask(task.id, {
      status: 'in_progress',
      branch: `skaro/${task.id}`,
    });
    this.context.invalidate();
    return updated;
  }

  async commit(root = this.repo, message = 'fixture inputs'): Promise<void> {
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-qm', message]);
    this.context.invalidate();
  }

  async checkout(task: Task): Promise<string> {
    const worktree = join(this.root, task.id);
    await this.context.git.createWorktree({ path: worktree, branch: task.branch!, base: 'main' });
    this.db.createRun({
      projectId: this.projectId,
      taskId: task.id,
      agent: 'codex',
      worktree,
      branch: task.branch!,
      logPath: `runs/${task.id}.jsonl`,
      adapterVersion: 'test-record-only',
    });
    return worktree;
  }

  async accept(task: Task, worktree: string, name = `${task.id}.txt`): Promise<void> {
    await writeFile(join(worktree, name), `${task.id} result\n`);
    await this.coordinator.capture(
      this.projectId,
      task.id,
      task.branch!,
      worktree,
      `feat: ${task.id}`,
      `Accepted ${task.id}`,
    );
  }

  async reconcile(): Promise<void> {
    await reconcileCompletions(this.context, this.hooks(), (_project, _task, error) =>
      this.errors.push(String(error)),
    );
  }

  async restart(): Promise<void> {
    await this.coordinator.close();
    this.projects.close();
    this.db.close();
    this.db = AppDb.open(join(this.root, 'app.sqlite'));
    this.projects = new Projects(this.db, () => undefined);
    this.coordinator = new CompletionCoordinator(this.hooks());
  }

  async close(): Promise<void> {
    await this.coordinator.close();
    this.projects.close();
    this.db.close();
    const target = resolve(this.root);
    const inside = relative(resolve(tmpdir()), target);
    if (
      !inside ||
      isAbsolute(inside) ||
      inside.startsWith('..') ||
      !inside.startsWith('skaro-completion-test-')
    )
      throw new Error(`Refuse fixture cleanup outside its temporary root: ${target}`);
    await rm(target, { recursive: true, force: true, maxRetries: 5 });
  }
}
