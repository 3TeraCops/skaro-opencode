// State of the "Чат" section: the chat list, then the open chat — its view from the main process
// and live timeline batches.

import { Timeline, type TimelineState } from '@skaro/timeline';
import type { ChatView } from '../../../shared/ipc';
import { readSession, saveSession } from '../session-snapshot';
import { currentHistory } from '../history-view';

export class ChatSession {
  readonly projectId: string;
  readonly chatId: string;
  view = $state.raw<ChatView | undefined>();
  timeline = $state.raw<TimelineState | undefined>();
  error = $state<string | undefined>();
  private live: Timeline | undefined;
  private seq = 0;
  private readonly unsubscribe: (() => void)[] = [];
  private reloading: Promise<void> | undefined;
  private reloadAgain = false;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  rememberPage(page: import('../../../shared/history').HistoryPage): void {
    if (!this.view) return;
    this.view = { ...this.view, historyPage: page };
    this.remember();
  }

  constructor(projectId: string, chatId: string) {
    this.projectId = projectId;
    this.chatId = chatId;
    this.view = readSession<ChatView>(`chat.${projectId}.${chatId}`);
    this.timeline = this.view?.timeline;
    this.unsubscribe.push(
      window.skaro.on('chat.events', (batch) => {
        if (batch.projectId !== projectId || batch.chatId !== chatId) return;
        if (this.view?.history) return;
        if (!this.live || batch.seq > this.seq) {
          // A gap: the snapshot is the truth.
          void this.reload();
          return;
        }
        const fresh = batch.events.slice(this.seq - batch.seq);
        if (!fresh.length) return;
        for (const event of fresh) this.live.apply(event);
        this.seq += fresh.length;
        this.timeline = { ...this.live.state };
        this.remember();
      }),
      window.skaro.on('history.changed', (change) => {
        if (change.owner !== `${projectId}:chat:${chatId}`) return;
        if (change.error) {
          void this.reload();
          return;
        }
        if (
          !change.view ||
          !this.view?.history ||
          change.view.source.revision < this.view.history.revision
        )
          return;
        this.view = {
          ...this.view,
          history: change.view.source,
          historyPage: change.view.page,
          timeline: change.view.timeline,
        };
        this.generation++;
        this.timeline = change.view.timeline;
        this.remember();
      }),
      window.skaro.on('chats.changed', (p) => {
        if (p.projectId === projectId && p.chatId === chatId) void this.reload();
      }),
    );
  }

  /** Loads (or reloads) the view; overlapping calls collapse into one more round. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        try {
          const generation = this.generation;
          let view = await window.skaro.invoke('chat.open', this.projectId, this.chatId, {
            paged: true,
          });
          if (generation !== this.generation) view = currentHistory(view, this.view);
          this.view = view;
          this.error = undefined;
          if (view.history) {
            this.seq = view.seq;
            this.timeline = view.timeline;
            this.live = undefined;
            this.remember();
          } else if (view.seq > this.seq || !this.live) {
            this.seq = view.seq;
            this.live = Timeline.restore(view.timeline);
            this.timeline = { ...this.live.state };
            this.remember();
          }
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } while (this.reloadAgain);
    })().finally(() => (this.reloading = undefined));
    return this.reloading;
  }

  dispose(): void {
    clearTimeout(this.snapshotTimer);
    this.save();
    for (const off of this.unsubscribe) off();
  }
  private save(): void {
    if (this.view) saveSession(`chat.${this.projectId}.${this.chatId}`, this.view, this.timeline);
  }
  private remember(): void {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.save(), 750);
  }
}
