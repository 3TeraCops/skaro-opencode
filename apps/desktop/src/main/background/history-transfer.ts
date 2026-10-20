import { randomUUID } from 'node:crypto';
import type { TimelineState } from '@skaro/timeline';

export interface HistorySnapshot {
  timeline: TimelineState;
  seq: number;
  segments: number;
}
export interface HistoryTransfer extends HistorySnapshot {
  token: string;
  count: number;
}

/** Keep archive arrays in the worker and transfer a bounded number of records at a time. */
export class HistoryTransfers {
  private readonly pending = new Map<string, { items: TimelineState['items']; at: number }>();
  open(snapshot: HistorySnapshot): HistoryTransfer {
    const token = randomUUID();
    this.pending.set(token, { items: snapshot.timeline.items, at: 0 });
    return {
      ...snapshot,
      token,
      count: snapshot.timeline.items.length,
      timeline: { ...snapshot.timeline, items: [] },
    };
  }
  next(token: string) {
    const transfer = this.pending.get(token);
    if (!transfer) throw new Error('History transfer expired');
    const items: TimelineState['items'] = [];
    let bytes = 0;
    while (transfer.at < transfer.items.length && items.length < 32 && bytes < 256_000) {
      const item = transfer.items[transfer.at++]!;
      items.push(item);
      // Serialization stays off the main thread. Large individual fields remain whole records.
      bytes += JSON.stringify(item).length * 2;
    }
    const done = transfer.at === transfer.items.length;
    if (done) this.pending.delete(token);
    return { items, done };
  }
  close(token: string): void {
    this.pending.delete(token);
  }
}
