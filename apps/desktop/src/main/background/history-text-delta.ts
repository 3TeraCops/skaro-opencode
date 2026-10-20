import { Timeline, emptyTimeline, type Item, type TimelineEvent } from '@skaro/timeline';
import type { PayloadStore } from './payload-store';

export type TextDelta = Extract<TimelineEvent, { t: 'item.append' }>;

/** An evicted conversation streams text by reading only the records that actually changed. */
export function applyTextDeltas(
  store: PayloadStore,
  owner: string,
  events: TextDelta[],
  resident?: Timeline,
): Map<string, Item> {
  const ids = new Set(events.map((event) => event.itemId));
  let timeline = resident;
  if (!timeline) {
    const query = store.db.prepare('SELECT value FROM feed_items WHERE owner=? AND id=?');
    const items: Item[] = [];
    for (const id of ids) {
      const row = query.get(owner, id);
      if (row) items.push(JSON.parse(String(row['value'])) as Item);
    }
    timeline = Timeline.restore({ ...emptyTimeline(), items });
  }
  for (const event of events) timeline.apply(event);
  const items = new Map<string, Item>();
  const update = store.db.prepare('UPDATE feed_items SET value=? WHERE owner=? AND id=?');
  for (const id of ids) {
    const item = timeline.item(id);
    if (!item) continue;
    update.run(JSON.stringify(item), owner, id);
    items.set(id, item);
  }
  return items;
}
