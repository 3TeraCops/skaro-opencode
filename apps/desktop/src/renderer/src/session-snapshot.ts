import type { ChatView, TaskView } from '../../shared/ipc';
import type { TimelineState } from '@skaro/timeline';
import type { HistoryPage } from '../../shared/history';

const VERSION = 'skaro.session.v1.';
const MAX_BYTES = 256_000;
const sessions = new Map<string, ChatView | TaskView>();
function fits(value: unknown, limit: number): number {
  let size = 0;
  const visit = (part: unknown): boolean => {
    if (typeof part === 'string') size += part.length + 2;
    else if (part && typeof part === 'object') {
      for (const key in part) {
        size += key.length + 4;
        if (size > limit || !visit((part as Record<string, unknown>)[key])) return false;
      }
    } else size += 8;
    return size <= limit;
  };
  return visit(value) ? size : limit + 1;
}
/** A real last-rendered viewport for the first frame. Canonical history always reloads via IPC. */
function viewport(state: TimelineState): TimelineState {
  const items: TimelineState['items'] = [];
  let budget = MAX_BYTES;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    const size = fits(item, budget);
    if (size > budget) break;
    items.unshift(item);
    budget -= size;
    if (items.length >= 80) break;
  }
  const turns = new Set(items.map((item) => item.turnId));
  return { ...state, items, turns: state.turns.filter((turn) => turns.has(turn.id)) };
}
export function readSession<T extends ChatView | TaskView>(key: string): T | undefined {
  try {
    const cached = sessions.get(key) ?? window.skaro.bootstrap?.sessions?.[key];
    if (cached) return cached as T;
    const raw = localStorage.getItem(VERSION + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function pageViewport(page: HistoryPage | undefined): HistoryPage | undefined {
  if (!page) return;
  const blocks: HistoryPage['blocks'] = [];
  let budget = MAX_BYTES;
  for (let index = page.blocks.length - 1; index >= 0; index--) {
    const block = page.blocks[index]!;
    const size = fits(block, budget);
    if (size > budget) break;
    blocks.unshift(block);
    budget -= size;
  }
  return { ...page, start: page.start + page.blocks.length - blocks.length, blocks };
}
export function saveSession(
  key: string,
  view: ChatView | TaskView,
  state: TimelineState | undefined,
): void {
  if (!state) return;
  try {
    const value = {
      ...view,
      timeline: viewport(state),
      timelineSources: undefined,
      historyPage: pageViewport(view.historyPage),
    };
    if (fits(value, MAX_BYTES * 2) > MAX_BYTES * 2) return;
    sessions.delete(key);
    sessions.set(key, value);
    while (sessions.size > 8) sessions.delete(sessions.keys().next().value!);
    void window.skaro.invoke('session.remember', key, value).catch(() => undefined);
  } catch {
    /* Storage pressure must not prevent owner input. */
  }
}
