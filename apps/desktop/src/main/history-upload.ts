import type { TimelineState } from '@skaro/timeline';
import { background } from './background/client';
import { presentationItem } from './timeline-presentation';
import type { HistoryOrigin } from '../shared/history';

export type HistoryQueue = <T>(owner: string, action: () => Promise<T>) => Promise<T>;
export function captureHistory(state: TimelineState): TimelineState {
  return {
    ...state,
    items: state.items.slice(),
    turns: state.turns.map((turn) => ({ ...turn })),
    interactions: state.interactions.slice(),
  };
}
/** Bounded worker messages keep first indexing from cloning one large conversation on main. */
export async function uploadHistory(
  dataDir: string,
  owner: string,
  signature: string,
  state: TimelineState,
  origins?: HistoryOrigin[],
  force?: boolean,
) {
  const upload = await background(dataDir, 'read.begin', owner, signature, { ...state, items: [] });
  try {
    for (let i = 0; i < state.items.length; i += 32)
      await background(
        dataDir,
        'read.append',
        upload,
        state.items.slice(i, i + 32).map(presentationItem),
      );
    return await background(dataDir, 'read.commit', upload, origins, force);
  } catch (error) {
    await background(dataDir, 'read.cancel', upload).catch(() => undefined);
    throw error;
  }
}
