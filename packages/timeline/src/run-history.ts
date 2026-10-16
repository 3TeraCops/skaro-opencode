import type { TimelineEvent } from './model.ts';
import { Timeline, type TimelineState } from './state.ts';

/** Native ids are local to an agent session. Skaro's recorded meta events are already scoped. */
export function runEvent(event: TimelineEvent, runId: string): TimelineEvent {
  const id = (value: string) => (value ? `${runId}:${value}` : '');
  switch (event.t) {
    case 'turn.started':
    case 'turn.completed':
      return { ...event, turnId: id(event.turnId) };
    case 'item.upsert':
      return {
        ...event,
        item: {
          ...event.item,
          id: id(event.item.id),
          turnId: id(event.item.turnId),
          ...(event.item.parentId ? { parentId: id(event.item.parentId) } : {}),
        },
      };
    case 'item.append':
      return { ...event, itemId: id(event.itemId) };
    case 'interaction.opened':
      return {
        ...event,
        interaction: {
          ...event.interaction,
          id: id(event.interaction.id),
          ...('itemId' in event.interaction && event.interaction.itemId
            ? { itemId: id(event.interaction.itemId) }
            : {}),
        },
      };
    case 'interaction.closed':
      return { ...event, id: id(event.id) };
    case 'rewound':
      return { ...event, toItemId: id(event.toItemId) };
    default:
      return event;
  }
}

/** Historical content and Skaro merge cards survive; live state belongs to the successor. */
export function continuationTimeline(state: TimelineState): Timeline {
  const copy = structuredClone(state);
  copy.status = 'idle';
  copy.interactions = copy.interactions.filter((i) => i.kind === 'merge');
  for (const turn of copy.turns) if (!turn.outcome) turn.outcome = 'interrupted';
  for (const item of copy.items)
    if (item.status === 'running' || item.status === 'queued') item.status = 'interrupted';
  delete copy.session;
  delete copy.usage;
  delete copy.limits;
  delete copy.activity;
  delete copy.plan;
  return Timeline.restore(copy);
}
