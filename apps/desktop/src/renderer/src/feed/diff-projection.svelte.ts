import type { DiffProjection, DiffRequest, DiffResult } from './diff-worker';
import type { Segment } from './diff-highlight';

/** Complete parsing and grammar state stay outside the renderer's input/layout thread. */
export function createDiffProjection(source: () => DiffRequest, onerror: (error: string) => void) {
  let projection = $state.raw<DiffProjection>();
  let colors = $state.raw<(Segment[] | undefined)[] | undefined>();
  let revision = $state(0);
  $effect(() => {
    const request = source();
    let disposed = false;
    projection = undefined;
    colors = undefined;
    // The immutable URL is resolved by Vite, not used as reactive application state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const worker = new Worker(new URL('./diff-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DiffResult>) => {
      if (disposed) return;
      const result = event.data;
      if (result.type === 'lines') projection = result.value;
      else if (result.type === 'colors') colors = result.value;
      else onerror(result.message);
      revision++;
    };
    worker.onerror = (event) => {
      if (!disposed) onerror(event.message);
    };
    worker.postMessage({ ...request, diffs: [...request.diffs] });
    return () => {
      disposed = true;
      worker.terminate();
    };
  });
  return {
    get projection() {
      return projection;
    },
    get colors() {
      return colors;
    },
    get revision() {
      return revision;
    },
  };
}
