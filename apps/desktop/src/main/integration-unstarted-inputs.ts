import type { TimelineEvent } from '@skaro/timeline';

/**
 * Messages sent to the resolver that it has not picked up yet. A turn can end before that:
 * a resumed Claude session first reports the background command stopped with its previous run.
 */
export class UnstartedInputs {
  private readonly queued = new Set<string>();

  observe(event: TimelineEvent): void {
    if (event.t !== 'item.upsert' || event.item.kind !== 'message' || event.item.role !== 'user')
      return;
    if (event.item.status === 'queued') this.queued.add(event.item.id);
    else this.queued.delete(event.item.id);
  }

  get waiting(): boolean {
    return this.queued.size > 0;
  }
}
