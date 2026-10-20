import type { FileRow } from '@skaro/timeline';
import { untrack } from 'svelte';
import type { DiffLine } from './diff-model';
import { windowedLineLength, type InlineDiffResponse } from './inline-diff-contract';
import { textMetricsStyle } from './text-fonts';

/** A mounted diff owns its worker and a bounded set of requested pages. */
export function createInlineDiff(options: {
  node(): HTMLElement | undefined;
  row(): Pick<FileRow, 'diffs' | 'change'>;
  onerror(error: string): void;
}) {
  const diffs = $derived(options.row().diffs);
  const change = $derived(options.row().change);
  let metadata = $state.raw<{ count: number; width: number; height: number }>();
  let revision = $state(0);
  let serial = 0;
  let version = 0;
  let worker: Worker | undefined;
  // Requests are resolved into WindowedContent's reactive, bounded page cache.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pending = new Map<number, (rows: DiffLine[]) => void>();
  $effect(() => {
    const node = options.node();
    const currentDiffs = diffs;
    const currentChange = change;
    if (!node) return;
    return untrack(() => {
      let disposed = false;
      metadata = undefined;
      const style = textMetricsStyle(node);
      const height = Number.parseFloat(getComputedStyle(node).lineHeight);
      // Vite resolves this immutable asset URL at build time.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const current = new Worker(new URL('./inline-diff-worker.ts', import.meta.url), {
        type: 'module',
      });
      worker = current;
      current.onmessage = (event: MessageEvent<InlineDiffResponse>) => {
        if (disposed) return;
        const result = event.data;
        if (result.type === 'ready') {
          metadata = { count: result.count, width: 0, height };
          revision = ++version;
        } else if (result.type === 'width') {
          if (metadata) metadata = { ...metadata, width: result.width };
        } else if (result.type === 'page') {
          pending.get(result.id)?.(result.lines);
          pending.delete(result.id);
        } else fail(result.message);
      };
      function fail(message: string) {
        if (disposed) return;
        for (const resolve of pending.values()) resolve([]);
        pending.clear();
        options.onerror(message);
      }
      current.onerror = (event) => fail(event.message);
      current.postMessage({ type: 'open', diffs: [...currentDiffs], change: currentChange, style });
      return () => {
        disposed = true;
        current.terminate();
        worker = undefined;
        for (const resolve of pending.values()) resolve([]);
        pending.clear();
      };
    });
  });
  return {
    get metadata() {
      return metadata;
    },
    get revision() {
      return revision;
    },
    async read(start: number) {
      if (!worker || !metadata) return [];
      const id = ++serial;
      const lines = await new Promise<DiffLine[]>((resolve) => {
        pending.set(id, resolve);
        worker!.postMessage({ type: 'page', id, start });
      });
      // Keep the existing page placeholder until its rendering engine is available.
      const textView = lines.some((line) => line.text.length > windowedLineLength)
        ? (await import('./inline-diff-text')).inlineDiffText
        : undefined;
      return lines.map((entry, offset) => ({
        id: String(start + offset),
        entry,
        textView: entry.text.length > windowedLineLength ? textView : undefined,
      }));
    },
  };
}
