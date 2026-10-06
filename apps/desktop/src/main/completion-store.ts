import { createHash, randomUUID } from 'node:crypto';
import type { AppDb, Task } from '@skaro/core';
import { taskSections } from './task-body';

export interface TaskResult {
  taskId: string;
  head: string;
  branch: string;
  worktree?: string;
  sharedCheckout?: boolean;
  criteria: string;
  message: string;
  summary?: string;
  /** The accepted result is durable; its task-file projection still needs to be written. */
  pendingReview?: boolean;
}

export interface CompletionOperation {
  id: string;
  base: string;
  results: TaskResult[];
  strategy: 'merge' | 'squash' | 'rebase';
  state: 'preparing' | 'prepared' | 'completed' | 'failed' | 'reverted';
  before?: string;
  commit?: string;
  error?: string;
  external?: boolean;
  revertCandidate?: { before: string; commit: string };
}

/** Only acceptance inputs: adding the result summary does not invalidate the result. */
export function criteriaRevision(task: Task): string {
  const { goal, criteria, notes } = taskSections(task.body);
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: task.title,
        goal,
        criteria,
        notes,
        spec: task.spec,
        dependencies: task.dependsOn,
        milestone: task.milestone,
      }),
    )
    .digest('hex');
}

/** Durable execution facts. Task status remains in .skaro/, not in a second status table. */
export class CompletionStore {
  private readonly db: AppDb;
  readonly projectId: string;
  constructor(db: AppDb, projectId: string) {
    this.db = db;
    this.projectId = projectId;
  }

  result(taskId: string): TaskResult | undefined {
    return this.db.getSetting<TaskResult | null>(this.resultKey(taskId), null) ?? undefined;
  }

  saveResult(result: TaskResult): void {
    this.db.setSetting(this.resultKey(result.taskId), result);
  }

  issues(): Record<string, string> {
    return this.db.getSetting(`completion.${this.projectId}.issues`, {});
  }
  issue(taskId: string | undefined, error?: string): void {
    const issues = this.issues();
    const key = taskId ?? 'project';
    if (error) issues[key] = error;
    else delete issues[key];
    this.db.setSetting(`completion.${this.projectId}.issues`, issues);
  }

  operations(): CompletionOperation[] {
    return this.db.getSetting<CompletionOperation[]>(this.operationKey(), []);
  }

  save(operation: CompletionOperation): void {
    const operations = this.operations().filter((item) => item.id !== operation.id);
    this.db.setSetting(this.operationKey(), [...operations, operation]);
  }

  create(base: string, results: TaskResult[], strategy: CompletionOperation['strategy']) {
    const operation: CompletionOperation = {
      id: randomUUID(),
      base,
      results,
      strategy,
      state: 'preparing',
    };
    this.save(operation);
    return operation;
  }

  private resultKey(taskId: string) {
    return `completion.${this.projectId}.result.${taskId}`;
  }
  private operationKey() {
    return `completion.${this.projectId}.operations`;
  }
}
