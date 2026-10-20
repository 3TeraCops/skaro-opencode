import type { ChatSummary } from '../../../shared/ipc';
import type { ChatRange, ChatCatalog } from '../../../shared/chat-catalog';

let bootstrapAvailable = true;

/** The screen owns a descriptor and the first page; WindowedContent owns bounded visible pages. */
export class ChatList {
  readonly projectId: string;
  archived = $state(false);
  source = $state.raw<ChatRange>();
  loaded = $state(false);
  revision = $state(0);
  activeCount = $state(0);
  archivedCount = $state(0);
  latest = $state<string>();
  private initial: ChatSummary[] = [];
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly off: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(projectId: string) {
    this.projectId = projectId;
    const initial = bootstrapAvailable ? window.skaro.bootstrap?.chatCatalog : undefined;
    if (initial?.source.projectId === projectId && !initial.source.archived) {
      bootstrapAvailable = false;
      this.accept(initial);
    }
    $effect(() => {
      void this.archived;
      void this.reload();
    });
    this.off = window.skaro.on('chats.changed', (event) => {
      if (event.projectId !== projectId) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.reload(), 0);
    });
  }
  private accept(result: ChatCatalog): void {
    this.source = result.source;
    this.activeCount = result.activeCount;
    this.archivedCount = result.archivedCount;
    this.latest = result.latest;
    this.initial = result.chats;
    this.loaded = true;
    this.revision++;
  }
  reload(): Promise<void> {
    const generation = ++this.generation;
    this.pending = window.skaro
      .invoke('chats.query', this.projectId, this.archived)
      .then((result) => {
        if (generation === this.generation) this.accept(result);
      })
      .catch((error: unknown) => console.error('Chat catalog:', error));
    return this.pending;
  }
  get count(): number {
    return this.source?.count ?? 1;
  }
  get identity(): string {
    return `${this.projectId}:${this.archived}`;
  }
  read = async (start: number): Promise<ChatSummary[]> => {
    // Already indexed rows can paint while a refresh is still waiting for the backend.
    if (this.source?.archived === this.archived && (start === 0 || start < this.initial.length))
      return this.initial.slice(start, start + 16);
    await this.pending;
    const source = this.source;
    const generation = this.generation;
    if (!source || source.archived !== this.archived) return [];
    if (start === 0) return this.initial;
    const result = await window.skaro.invoke('chats.page', source, start);
    if (generation !== this.generation) return [];
    if (result.source.revision !== source.revision) {
      await this.reload();
      return this.read(start);
    }
    return result.chats;
  };
  async find(id: string): Promise<number> {
    await this.pending;
    const source = this.source;
    if (!source || source.archived !== this.archived) return -1;
    const result = await window.skaro.invoke('chats.find', source, id);
    if (result.source.revision !== source.revision) {
      await this.reload();
      return this.find(id);
    }
    return result.index;
  }
  dispose(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.off();
  }
}
