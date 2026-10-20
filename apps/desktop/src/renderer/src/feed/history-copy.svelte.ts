import type { FeedRow } from '@skaro/timeline';
import type { FeedActions } from './context.svelte';

/** Include immediate owner echoes while native delivery and the read projection catch up. */
export function installHistoryCopy(getRows: () => FeedRow[] | undefined, feed: FeedActions): void {
  $effect(() => {
    if (!getRows()) return;
    const pending = () =>
      (getRows() ?? []).flatMap((row) =>
        row.type === 'user' ? [{ id: row.item.native.ref, text: row.item.text }] : [],
      );
    feed.pendingHistory = pending;
    return () => {
      if (feed.pendingHistory === pending) feed.pendingHistory = undefined;
    };
  });
}
