import type { AppDb } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';

interface Startup {
  inputs: MessageInput[];
  error?: string;
  updatedAt: number;
}

/** Preparation failures exist before an agent run; their input and diagnostic must survive. */
export class TaskStartup {
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting' | 'listEvents'>;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting' | 'listEvents'>) {
    this.db = db;
  }
  private key(project: string, task: string) {
    return `startup.${project}.${task}`;
  }
  read(project: string, task: string): Startup | undefined {
    return this.db.getSetting<Startup | null>(this.key(project, task), null) ?? undefined;
  }
  begin(project: string, task: string, inputs: MessageInput[]): MessageInput[] {
    const saved = this.read(project, task);
    const combined = [...(saved?.inputs ?? [])];
    for (const input of inputs)
      if (!input.commandId || !combined.some((existing) => existing.commandId === input.commandId))
        combined.push(input);
    this.db.setSetting(this.key(project, task), {
      inputs: combined,
      error: undefined,
      updatedAt: Date.now(),
    });
    return combined.length ? combined : [{ text: '' }];
  }
  delivered(project: string, task: string): void {
    this.db.setSetting(this.key(project, task), null);
  }
  fail(project: string, task: string, error: string): void {
    this.db.setSetting(this.key(project, task), {
      inputs: this.read(project, task)?.inputs ?? [],
      error,
      updatedAt: Date.now(),
    });
  }
  error(project: string, task: string): string | undefined {
    const saved = this.read(project, task);
    if (saved) return saved.error;
    return this.db
      .listEvents(project, 200)
      .find(
        (event) => event.kind === 'task_failed' && (event.data as { task?: string }).task === task,
      )?.data.error as string | undefined;
  }
}
