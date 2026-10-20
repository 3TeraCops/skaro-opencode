import type { ChatView, TaskView } from '../../shared/ipc';

/** An in-flight open must not overwrite a newer native event that arrived before its reply. */
export function currentHistory<T extends ChatView | TaskView>(
  incoming: T,
  current: T | undefined,
): T {
  if (
    !incoming.history ||
    !current?.history ||
    current.history.revision <= incoming.history.revision
  )
    return incoming;
  return {
    ...incoming,
    history: current.history,
    timeline: current.timeline,
    historyPage: current.historyPage,
  };
}
