const PAGE_SIZE = 16;

/** A published window contains pages from one revision, never a mix of old and new order. */
export class WindowedPages<Block> {
  private generation = 0;
  private readonly pending = new Map<number, Promise<void>>();
  private readonly ready = new Map<number, readonly Block[]>();
  private readonly onReady: (blocks: Map<number, Block>) => void;

  constructor(onReady: (blocks: Map<number, Block>) => void) {
    this.onReady = onReady;
  }

  reset(): void {
    this.generation++;
    this.pending.clear();
    this.ready.clear();
  }

  async read(
    start: number,
    end: number,
    read: (start: number) => Promise<readonly Block[]>,
    held: (start: number) => boolean,
    focused?: number,
  ): Promise<Map<number, Block> | undefined> {
    const generation = this.generation;
    const needed = new Set<number>();
    for (let at = Math.floor(start / PAGE_SIZE) * PAGE_SIZE; at < end; at += PAGE_SIZE)
      needed.add(at);
    if (focused !== undefined) needed.add(Math.floor(focused / PAGE_SIZE) * PAGE_SIZE);
    await Promise.all(
      [...needed].map((at) => {
        let request = this.pending.get(at);
        if (!request) {
          request = read(at)
            .then((rows) => {
              if (generation === this.generation && this.pending.get(at) === request) {
                this.ready.set(at, rows);
                this.onReady(this.snapshot());
              }
            })
            .catch((error: unknown) => {
              if (generation === this.generation && this.pending.get(at) === request)
                this.pending.delete(at);
              throw error;
            });
          this.pending.set(at, request);
        }
        return request;
      }),
    );
    if (generation !== this.generation) return;
    for (const at of this.pending.keys()) {
      if (this.pending.size <= 12) break;
      if (needed.has(at) || held(at)) continue;
      this.pending.delete(at);
      this.ready.delete(at);
    }
    return this.snapshot();
  }

  private snapshot(): Map<number, Block> {
    const blocks = new Map<number, Block>();
    for (const [at, rows] of this.ready)
      for (let offset = 0; offset < Math.min(PAGE_SIZE, rows.length); offset++)
        blocks.set(at + offset, rows[offset]!);
    return blocks;
  }
}
