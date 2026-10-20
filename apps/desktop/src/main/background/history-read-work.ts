import { randomUUID } from 'node:crypto';
import type { TimelineState, TimelineEvent } from '@skaro/timeline';
import type { HistorySource, HistoryOrigin, HistoryPending } from '../../shared/history';
import type { PayloadStore } from './payload-store';
import { HistoryIndex } from './history-index';
import { feedText } from '../../shared/history-text';
import { feedRows } from '@skaro/timeline';
import { HistoryReceipts } from './history-receipts';

export function historyReadWork(store: PayloadStore) {
  const index = new HistoryIndex(store);
  const receipts = new HistoryReceipts(store);
  const staging = new Map<string, { owner: string; signature: string; state: TimelineState }>();
  return {
    'read.certify': (source: HistorySource, path: string, subject: number) =>
      receipts.save(source, path, subject),
    'read.peek': (owner: string, path: string, subject: number) =>
      receipts.read(owner, path, subject, (signature) => index.matches(owner, signature)),
    'read.match': (owner: string, signature: string) => index.matches(owner, signature),
    'read.begin': (owner: string, signature: string, state: TimelineState) => {
      const id = randomUUID();
      staging.set(id, { owner, signature, state });
      return id;
    },
    'read.append': (id: string, items: TimelineState['items']) => {
      const pending = staging.get(id);
      if (!pending) throw new Error('The history upload expired');
      pending.state.items.push(...items);
    },
    'read.commit': (id: string, origins?: HistoryOrigin[], force?: boolean) => {
      const pending = staging.get(id);
      if (!pending) throw new Error('The history upload expired');
      staging.delete(id);
      return index.withSnapshot(() =>
        index.initialize(pending.owner, pending.signature, pending.state, origins, force),
      );
    },
    'read.cancel': (id: string) => {
      staging.delete(id);
    },
    'read.events': (
      owner: string,
      events: TimelineEvent[],
      signature: string,
      origin?: { id: string; seq: number },
    ) => index.withSnapshot(() => index.events(owner, events, signature, origin)),
    'read.origins': (owner: string, origins: HistoryOrigin[], force: boolean) =>
      index.controls(owner, origins, force),
    'read.changes': (source: HistorySource, start: number) => index.changePage(source, start),
    'read.page': (source: HistorySource, start: number, limit: number) =>
      index.page(source, start, limit),
    'read.find': (source: HistorySource, id: string) => index.find(source, id),
    'read.copy': (source: HistorySource, pending: HistoryPending[] = []) =>
      index.withSnapshot(() => {
        const state = index.state(source);
        const known = new Set<string>();
        for (const item of state.items)
          if (item.kind === 'message' && item.role === 'user') {
            known.add(item.native.ref);
            for (const match of item.text.matchAll(/command_id: ([^\r\n]+)/g)) known.add(match[1]!);
          }
        return [
          feedText(feedRows(state)),
          ...pending.filter((item) => !known.has(item.id)).map((item) => item.text),
        ]
          .filter(Boolean)
          .join('\n\n');
      }),
  };
}
