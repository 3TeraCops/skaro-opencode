import { Timeline } from '@skaro/timeline';
import { background } from './background/client';
import type { BackgroundMethods } from './background/protocol';

/** Command restoration yields to owner input between pages; no archive-sized structured clone. */
export async function restoreHistory(
  dataDir: string,
  ...args: Parameters<BackgroundMethods['history.restore']>
) {
  const restored = await background(dataDir, 'history.open', ...args);
  const timeline = Timeline.restore(restored.timeline);
  try {
    for (;;) {
      const page = await background(dataDir, 'history.next', restored.token);
      timeline.restoreItems(page.items);
      if (page.done) break;
    }
    return { timeline, seq: restored.seq, segments: restored.segments };
  } finally {
    await background(dataDir, 'history.close', restored.token);
  }
}
