import type { Timeline } from '@skaro/timeline';

/** Working sessions, unanswered cards and background commands remain owned by their engine. */
export function canRetireHistory(timeline: Timeline): boolean {
  return (
    timeline.state.status === 'idle' &&
    !timeline.state.interactions.length &&
    !timeline.hasRunningItems
  );
}
