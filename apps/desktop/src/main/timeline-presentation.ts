import type { TimelineEvent, TimelineState, Item } from '@skaro/timeline';

/** Skaro tools have their own cards. Their hidden raw payload stays in the journal/domain. */
export function presentationItem(item: Item): Item {
  return item.kind === 'tool' && item.server === 'skaro'
    ? { ...item, input: undefined, output: undefined }
    : item;
}
export function presentationEvent(event: TimelineEvent): TimelineEvent {
  return event.t === 'item.upsert' ? { ...event, item: presentationItem(event.item) } : event;
}
export function presentationState(state: TimelineState): TimelineState {
  return { ...state, items: state.items.map(presentationItem) };
}
