import { Timeline, runEvent, type TimelineState } from '@skaro/timeline';
import type { AgentId } from './ipc-entities';

export interface IntegrationTimeline {
  id: string;
  seq: number;
  live: boolean;
  /** The agent of the session in `timeline`: a live one works instead of the task's own agent. */
  agent?: AgentId;
  effort?: string;
  timeline: TimelineState;
}

export function scopeTimeline(state: TimelineState, id: string): TimelineState {
  return {
    ...state,
    items: state.items.map((item) => {
      const event = runEvent({ t: 'item.upsert', item }, id);
      return event.t === 'item.upsert' ? event.item : item;
    }),
    turns: state.turns.map((turn) => ({ ...turn, id: turn.id ? `${id}:${turn.id}` : '' })),
    interactions: state.interactions.map((interaction) => {
      const event = runEvent({ t: 'interaction.opened', interaction }, id);
      return event.t === 'interaction.opened' ? event.interaction : interaction;
    }),
  };
}

/** Isolated histories cannot close each other's interactions or replace an idle task's model. */
export function composeTaskTimeline(
  base: TimelineState | undefined,
  integrations: IntegrationTimeline[],
) {
  if (base && !integrations.length) return { ...base };
  const state = base
    ? {
        ...base,
        items: [...base.items],
        turns: [...base.turns],
        interactions: [...base.interactions],
      }
    : new Timeline().state;
  for (const source of integrations) {
    state.items.push(...source.timeline.items);
    state.turns.push(...source.timeline.turns);
    state.interactions.push(...source.timeline.interactions);
    if (source.live)
      for (const field of ['status', 'session', 'usage', 'limits', 'activity', 'plan'] as const)
        Object.assign(state, { [field]: source.timeline[field] });
  }
  state.items.sort((a, b) => a.startedAt - b.startedAt);
  if (state.interactions.some((i) => i.kind === 'question')) state.status = 'waiting';
  return state;
}
