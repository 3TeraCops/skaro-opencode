import { onDestroy } from 'svelte';
import type { Block, Heading } from './parse';

export type DocBlock = Block & { id: string };
export type DocHeading = Heading & { position: number };
export interface DocProjection {
  revision: number;
  count: number;
  headings: DocHeading[];
}

/** Markdown parsing and its complete block array stay outside the renderer thread. */
export class DocumentProjection {
  view = $state.raw<DocProjection>();
  error = $state<string>();
  private worker?: Worker;
  private serial = 0;
  private generation = 0;
  // Request bookkeeping is published only through view/error.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(source: () => string) {
    $effect(() => {
      const text = source();
      const generation = ++this.generation;
      void this.request<DocProjection>({ method: 'open', source: text }).then(
        (view) => {
          if (generation === this.generation) {
            this.view = view;
            this.error = undefined;
          }
        },
        (error: unknown) => {
          if (generation === this.generation) this.error = String(error);
        },
      );
    });
    onDestroy(() => {
      this.worker?.terminate();
      for (const request of this.pending.values()) request.reject(new Error('Document closed'));
      this.pending.clear();
    });
  }
  private request<T>(message: object): Promise<T> {
    if (!this.worker) {
      // Vite recognizes the worker entry through this literal URL constructor.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      this.worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (
        event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
      ) => {
        const request = this.pending.get(event.data.id);
        if (!request) return;
        this.pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.value);
      };
      this.worker.onerror = (event) => {
        for (const request of this.pending.values()) request.reject(new Error(event.message));
        this.pending.clear();
      };
    }
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker!.postMessage({ ...message, id });
    });
  }
  page(revision: number, start: number): Promise<DocBlock[]> {
    return this.request({ method: 'page', revision, start });
  }
}
