// State of an open task screen: the view from the main process, then live timeline batches.

import type { TimelineState } from '@skaro/timeline';
import type { TaskView } from '../../../shared/ipc';
import { TaskFeedState } from './feed-state';

export class TaskSession {
  readonly projectId: string;
  readonly taskId: string;
  view = $state.raw<TaskView | undefined>();
  timeline = $state.raw<TimelineState | undefined>();
  error = $state<string | undefined>();
  private readonly feed = new TaskFeedState();
  private readonly unsubscribe: (() => void)[] = [];
  private reloading: Promise<void> | undefined;
  private reloadAgain = false;

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    const mine = (p: { projectId: string; taskId: string }) =>
      p.projectId === projectId && p.taskId === taskId;
    this.unsubscribe.push(
      window.skaro.on('task.events', (batch) => {
        if (!mine(batch)) return;
        if (!this.feed.task(batch)) {
          // A new run or a gap: the snapshot is the truth.
          void this.reload();
          return;
        }
        this.timeline = this.feed.state;
      }),
      window.skaro.on('integration.events', (batch) => {
        if (!mine(batch)) return;
        if (!this.feed.integration(batch)) void this.reload();
        else this.timeline = this.feed.state;
      }),
      window.skaro.on('task.changed', (p) => mine(p) && void this.reload()),
      window.skaro.on('project.changed', (p) => p.projectId === projectId && void this.reload()),
    );
  }

  /** Loads (or reloads) the view; overlapping calls collapse into one more round. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        try {
          const view = await window.skaro.invoke('task.open', this.projectId, this.taskId);
          this.view = view;
          this.error = view.error;
          this.feed.restore(view);
          this.timeline = this.feed.state;
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } while (this.reloadAgain);
    })().finally(() => (this.reloading = undefined));
    return this.reloading;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
  }
}
