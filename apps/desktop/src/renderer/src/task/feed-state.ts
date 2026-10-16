import { Timeline } from '@skaro/timeline';
import type { Events, TaskView } from '../../../shared/ipc';
import { composeTaskTimeline } from '../../../shared/task-timeline';

/** Native task and candidate streams have independent cursors and independent interactions. */
export class TaskFeedState {
  private base = new Timeline();
  private runId?: string;
  private seq = 0;
  private integrations = new Map<string, { seq: number; live: boolean; timeline: Timeline }>();

  restore(view: TaskView): void {
    if (this.runId !== view.run?.id || view.seq >= this.seq) {
      this.runId = view.run?.id;
      this.seq = view.seq;
      this.base = view.timelineSources?.base
        ? Timeline.restore(structuredClone(view.timelineSources.base))
        : view.timelineSources
          ? new Timeline()
          : view.timeline
            ? Timeline.restore(structuredClone(view.timeline))
            : new Timeline();
    }
    const next = new Map<string, { seq: number; live: boolean; timeline: Timeline }>();
    for (const source of view.timelineSources?.integrations ?? []) {
      const existing = this.integrations.get(source.id);
      next.set(
        source.id,
        existing && existing.seq > source.seq
          ? { ...existing, live: source.live }
          : {
              seq: source.seq,
              live: source.live,
              timeline: Timeline.restore(structuredClone(source.timeline)),
            },
      );
    }
    this.integrations = next;
  }

  task(batch: Events['task.events']): boolean {
    if (batch.runId !== this.runId || batch.seq > this.seq) return false;
    const fresh = batch.events.slice(this.seq - batch.seq);
    for (const event of fresh) this.base.apply(event);
    this.seq += fresh.length;
    return true;
  }

  integration(batch: Events['integration.events']): boolean {
    const source = this.integrations.get(batch.integrationId);
    if (!source || batch.seq > source.seq) return false;
    const fresh = batch.events.slice(source.seq - batch.seq);
    for (const event of fresh) source.timeline.apply(event);
    source.seq += fresh.length;
    return true;
  }

  get state() {
    return composeTaskTimeline(
      this.base.state,
      [...this.integrations].map(([id, source]) => ({
        id,
        seq: source.seq,
        live: source.live,
        timeline: source.timeline.state,
      })),
    );
  }
}
