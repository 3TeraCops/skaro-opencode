import type { LiveChat } from './chat-model';

/** A failed decision does not poison later work; each mutation sees its predecessor's result. */
export function serializeChatMutation<T>(live: LiveChat, action: () => Promise<T>): Promise<T> {
  const next = live.proposalQueue.catch(() => undefined).then(action);
  live.proposalQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
