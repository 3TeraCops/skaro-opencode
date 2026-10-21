import type { TimelineState } from '@skaro/timeline';
import type { EventName, Events } from '../shared/ipc';
import type { HistoryOrigin, HistoryView } from '../shared/history';
import { background } from './background/client';
import { captureHistory, uploadHistory, type HistoryQueue } from './history-upload';
import { HISTORY_VERSION } from '../shared/history';

interface Context {
  runId: string;
  token: string;
  origins: Map<string, { seq: number; live: boolean }>;
}
function signature(context: Context): string {
  return `${HISTORY_VERSION}:${context.token}|${[...context.origins].map(([id, item]) => `${id}:${item.seq}:${Number(item.live)}`).join('|')}`;
}
export class TaskHistoryReads {
  forget(owner: string): void {
    this.contexts.delete(owner);
  }
  private readonly contexts = new Map<string, Context>();
  private readonly initializing = new Set<string>();
  private readonly dataDir: string;
  private readonly queue: HistoryQueue;
  private readonly emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  constructor(
    dataDir: string,
    queue: HistoryQueue,
    emit: <E extends EventName>(event: E, payload: Events[E]) => void,
  ) {
    this.dataDir = dataDir;
    this.queue = queue;
    this.emit = emit;
  }
  sync(
    owner: string,
    runId: string,
    revision: string,
    origins: HistoryOrigin[],
    state: TimelineState,
  ): Promise<HistoryView> {
    const snapshot = captureHistory(state);
    const headers = origins.map((origin) => ({
      ...origin,
      timeline: {
        ...origin.timeline,
        items: [],
        turns: origin.timeline.turns.filter(
          (turn, index, turns) => !turn.outcome || index >= turns.length - 8,
        ),
      },
    }));
    this.initializing.add(owner);
    return this.queue(owner, async () => {
      const token = `${runId}:${revision}`;
      const previous = this.contexts.get(owner);
      const force = previous?.runId !== runId;
      const context: Context = {
        runId,
        token,
        origins: new Map(
          origins.map((origin) => [
            origin.id,
            {
              live: origin.live,
              seq: Math.max(origin.seq, force ? 0 : (previous?.origins.get(origin.id)?.seq ?? 0)),
            },
          ]),
        ),
      };
      const key = signature(context);
      let view = await background(this.dataDir, 'read.match', owner, key);
      if (!view) view = await uploadHistory(this.dataDir, owner, key, snapshot, headers, force);
      await background(this.dataDir, 'read.origins', owner, headers, force);
      this.contexts.set(owner, context);
      return view;
    }).finally(() => this.initializing.delete(owner));
  }
  observe(name: EventName, value: Events[EventName]): void {
    if (name !== 'task.events' && name !== 'integration.events') return;
    const batch = value as Events['task.events'] | Events['integration.events'];
    const owner = `${batch.projectId}:task:${batch.taskId}`;
    if (!this.contexts.has(owner) && !this.initializing.has(owner)) return;
    void this.queue(owner, async () => {
      const context = this.contexts.get(owner);
      const id = 'integrationId' in batch ? `integration-${batch.integrationId}` : 'base';
      if (!context || ('runId' in batch && batch.runId !== context.runId)) return;
      const origin = context.origins.get(id);
      if (!origin) {
        this.emit('history.changed', { owner });
        return;
      }
      const fresh = batch.events.slice(Math.max(0, origin.seq - batch.seq));
      if (!fresh.length) return;
      if (batch.seq > origin.seq) throw new Error('Task read-model event sequence gap');
      const seq = batch.seq + batch.events.length;
      const next: Context = { ...context, origins: new Map(context.origins) };
      next.origins.set(id, { ...origin, seq });
      const view = await background(this.dataDir, 'read.events', owner, fresh, signature(next), {
        id,
        seq,
      });
      if (view) {
        this.contexts.set(owner, next);
        this.emit('history.changed', { owner, view });
      }
    }).catch((error: unknown) => {
      console.error('Task history read model:', error);
      this.contexts.delete(owner);
      this.emit('history.changed', { owner, error: String(error) });
    });
  }
}
