import type { VirtualWindow } from './virtual-window.svelte';

interface Measurement {
  window: VirtualWindow;
  id: string;
  index: number;
  enabled: boolean;
}
/** ResizeObserver supplies an already computed border box; never force layout once per row. */
export function measureBlock(el: HTMLElement, value: Measurement) {
  let current = value;
  let observer: ResizeObserver | undefined;
  const watch = () => {
    observer?.disconnect();
    observer = undefined;
    if (!current.enabled) return;
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      current.window.measure(
        current.id,
        current.index,
        entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
      );
    });
    observer.observe(el);
  };
  watch();
  return {
    update(next: Measurement) {
      const changed = next.enabled !== current.enabled;
      current = next;
      if (changed) watch();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
