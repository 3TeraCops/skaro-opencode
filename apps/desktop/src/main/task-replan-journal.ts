import type { AppDb, NewTask, Task } from '@skaro/core';
import type { ProposalItem } from './chat-model';

export interface TaskReplanDecision {
  projectId: string;
  chatId: string;
  item: ProposalItem;
  phase: 'allocating' | 'writing' | 'applied' | 'reverting' | 'reverted';
  ids: Record<string, string>;
  preferences?: Record<string, unknown>;
  before: Task[];
  beforeFiles?: Record<string, string>;
  afterFiles?: Record<string, string>;
  reported?: 'applied' | 'reverted';
  revert?: {
    originals: { task: Task; before: string; after?: string }[];
    created: { task: Task; content: string }[];
    preferences: Record<string, { before: unknown; after: unknown }>;
  };
  writes: { id: string; input: NewTask; before?: Task }[];
  removes: Task[];
  error?: string;
}

export class TaskReplanJournal {
  private readonly db: AppDb;
  private readonly projectId: string;
  constructor(db: AppDb, projectId: string) {
    this.db = db;
    this.projectId = projectId;
  }
  private get key() {
    return `task.replans.${this.projectId}`;
  }
  list(): TaskReplanDecision[] {
    return this.db.getSetting(this.key, []);
  }
  save(decision: TaskReplanDecision): void {
    const all = this.list();
    const index = all.findIndex((d) => d.item.id === decision.item.id);
    if (index < 0) all.push(decision);
    else all[index] = decision;
    this.db.setSetting(this.key, all);
  }
}
