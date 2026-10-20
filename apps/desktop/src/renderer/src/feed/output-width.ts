import { textMetricsStyle } from './text-fonts';

/** Keep the full horizontal range; coalesce streaming requests behind one active measurement. */
export function outputWidth(
  node: HTMLElement,
  content: HTMLElement,
  onerror: (message: string) => void,
) {
  const style = textMetricsStyle(node);
  const endPadding = Number.parseFloat(getComputedStyle(node).paddingRight);
  const worker = new Worker(new URL('./output-width-worker.ts', import.meta.url), {
    type: 'module',
  });
  let active = false;
  let queued: string | undefined;
  let disposed = false;
  const send = (text: string) => {
    active = true;
    worker.postMessage({ text, style });
  };
  worker.onmessage = (event: MessageEvent<{ width?: number; error?: string }>) => {
    if (disposed) return;
    active = false;
    if (event.data.error) onerror(event.data.error);
    else if (queued === undefined && event.data.width !== undefined)
      content.style.minWidth = `${Math.max(0, event.data.width - endPadding)}px`;
    if (queued !== undefined) {
      const latest = queued;
      queued = undefined;
      send(latest);
    }
  };
  worker.onerror = (event) => {
    if (!disposed) onerror(event.message);
  };
  return {
    update(text: string) {
      if (active) queued = text;
      else send(text);
    },
    destroy() {
      disposed = true;
      queued = undefined;
      worker.terminate();
    },
  };
}
