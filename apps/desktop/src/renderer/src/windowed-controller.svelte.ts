import { tick, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { RangeWindow } from './feed/range-window.svelte';
import { FeedSelection } from './feed/feed-selection.svelte';
import { layoutFrame } from './layout-frame';
import { windowedFocus } from './windowed-focus.svelte';
import { WindowedPages } from './windowed-pages';

interface Options<Block extends { id: string }> {
  count: number;
  revision: number;
  identity?: string;
  read: (start: number) => Promise<readonly Block[]>;
  copyText?: () => string;
  scroller: string;
  gap: number;
  estimate: number;
  overscan: number;
}
export function createWindowedContent<Block extends { id: string }>(p: Options<Block>) {
  let root = $state<HTMLDivElement>();
  const range = new RangeWindow(p.estimate, p.gap, p.overscan);
  const blocks = new SvelteMap<number, Block>();
  const pages = new WindowedPages<Block>(publish);
  let refreshing = false;
  let previousIdentity: string | undefined;
  let focused = $state<number>();
  windowedFocus({
    root: () => root,
    count: () => p.count,
    retain: (index) => {
      focused = index;
    },
    reveal,
  });
  let cancelFrame: (() => void) | undefined;
  const selection = new FeedSelection({
    root: () => root,
    blocks: () => [],
    track: () => true,
    enabled: () => !!p.copyText,
    text: () => p.copyText?.() ?? '',
    position: (id) => Number(id),
  });
  const shown = $derived.by(() => {
    // A transient union has no independent reactive lifetime.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const indices = new Set<number>();
    for (let i = range.start; i < range.end; i++) indices.add(i);
    if (focused !== undefined) indices.add(focused);
    if (selection.range)
      for (let i = selection.range.start; i < selection.range.end; i++) indices.add(i);
    let previous = -1;
    return [...indices]
      .filter((i) => i < p.count)
      .sort((a, b) => a - b)
      .map((index) => {
        const before =
          index > previous + 1
            ? Math.max(0, range.offset(index) - range.offset(previous + 1) - p.gap)
            : 0;
        previous = index;
        return { index, block: blocks.get(index), before };
      });
  });
  const bottom = $derived(
    shown.length && shown.at(-1)!.index + 1 < p.count
      ? Math.max(0, range.offset(p.count) - range.offset(shown.at(-1)!.index + 1) - p.gap)
      : 0,
  );
  async function load(start: number, end: number): Promise<void> {
    try {
      const fresh = await pages.read(
        start,
        end,
        p.read,
        (at) =>
          (at < range.end && at + 16 > range.start) ||
          (focused !== undefined && at <= focused && focused < at + 16) ||
          !!(selection.range && at < selection.range.end && at + 16 > selection.range.start),
        focused,
      );
      if (fresh) publish(fresh);
    } catch (error) {
      console.error('Windowed page:', error);
    }
  }
  function publish(fresh: Map<number, Block>): void {
    // Initial indexed pages paint immediately. A refresh retains the old coherent
    // window until its visible pages and focused row can be replaced together.
    if (refreshing) {
      for (let at = Math.floor(range.start / 16) * 16; at < range.end; at += 16)
        if (at < p.count && !fresh.has(at)) return;
      if (focused !== undefined && focused < p.count && !fresh.has(focused)) return;
    }
    refreshing = false;
    for (const index of blocks.keys()) if (!fresh.has(index)) blocks.delete(index);
    for (const [index, block] of fresh) blocks.set(index, block);
  }
  const soon = () => {
    cancelFrame ??= layoutFrame(() => {
      cancelFrame = undefined;
      const container = root?.closest<HTMLElement>(p.scroller);
      if (!root || !container) return;
      const offset = container.getBoundingClientRect().top - root.getBoundingClientRect().top;
      const height = container.clientHeight;
      return () => range.update(offset, height);
    });
  };
  $effect(() => {
    void p.revision;
    const count = p.count,
      preserve = p.identity !== undefined && p.identity === previousIdentity;
    previousIdentity = p.identity;
    pages.reset();
    untrack(() => {
      refreshing = preserve && blocks.size > 0;
      if (!preserve) blocks.clear();
      else
        for (const index of blocks.keys()) {
          const held =
            index === focused ||
            (selection.range && index >= selection.range.start && index < selection.range.end);
          if (index >= count || (!held && (index < range.start || index >= range.end)))
            blocks.delete(index);
        }
      // Keep live rows and their measurements until fresh pages replace them atomically.
      range.reset(count, !preserve);
    });
    soon();
  });
  $effect(() => {
    void p.revision;
    void load(range.start, range.end);
  });
  $effect(() => {
    const container = root?.closest<HTMLElement>(p.scroller);
    if (!root || !container) return;
    const observer = new ResizeObserver(soon);
    observer.observe(root);
    observer.observe(container);
    container.addEventListener('scroll', soon, { passive: true });
    soon();
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', soon);
      cancelFrame?.();
      cancelFrame = undefined;
    };
  });
  function measure(element: HTMLElement, index: number) {
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height;
      if (height !== undefined) {
        range.measure(index, height);
        soon();
      }
    });
    observer.observe(element);
    return {
      update: (next: number) => {
        index = next;
      },
      destroy: () => observer.disconnect(),
    };
  }
  async function reveal(index: number): Promise<void> {
    const container = root?.closest<HTMLElement>(p.scroller);
    if (!container || !root) return;
    const start =
      container.scrollTop +
      root.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    range.update(range.offset(index), container.clientHeight);
    container.scrollTop = start + range.offset(index);
    await load(index, index + 1);
    await tick();
    root
      .querySelector<HTMLElement>(`[data-feed-block="${index}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return {
    get root() {
      return root;
    },
    set root(value: HTMLDivElement | undefined) {
      root = value;
    },
    range,
    get shown() {
      return shown;
    },
    get bottom() {
      return bottom;
    },
    measure,
    reveal,
  };
}
