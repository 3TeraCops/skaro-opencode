import { Timeline, type TimelineState } from '@skaro/timeline';
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

/** Isolated histories cannot close each other's interactions or replace an idle task's model. */
export function composeTaskTimeline(
  base: TimelineState | undefined,
  integrations: IntegrationTimeline[],
) {
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
  return state;
}
