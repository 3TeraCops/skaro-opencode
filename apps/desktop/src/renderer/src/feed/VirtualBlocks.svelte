<script lang="ts" generics="Block extends { id: string }">
  import type { Snippet } from 'svelte';
  import { VirtualWindow } from './virtual-window.svelte';
  import { useFeed } from './context.svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { FeedSelection } from './feed-selection.svelte';
  import { measureBlock } from './virtual-measure';
  import { layoutFrame } from '../layout-frame';
  let {
    blocks,
    children,
    primary = false,
    copyText,
    copyAll,
    gap = 14,
    estimate = 100,
    threshold = 100,
    revealIndex,
  }: {
    blocks: Block[];
    children: Snippet<[Block]>;
    primary?: boolean;
    copyText?: () => string;
    copyAll?: () => Promise<void>;
    gap?: number;
    estimate?: number;
    threshold?: number;
    revealIndex?: (id: string) => number;
  } = $props();
  // svelte-ignore state_referenced_locally
  const window = new VirtualWindow(gap, estimate);
  const feed = useFeed();
  let root = $state<HTMLDivElement>();
  const retained = new SvelteMap<string, string>();
  const virtual = $derived(blocks.length > threshold);
  const selection = new FeedSelection({
    root: () => root,
    blocks: () => blocks,
    enabled: () => !!copyAll || (primary && !!copyText),
    track: () => virtual || !!copyAll || (primary && !!copyText),
    text: () => copyText?.() ?? '',
    copyAll: () => copyAll?.(),
  });
  const from = $derived(virtual ? window.start : 0);
  const to = $derived(virtual ? window.end : blocks.length);
  const shown = $derived.by(() => {
    // A transient set inside this derivation has no independent reactive lifetime.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const indices = new Set<number>();
    for (let i = from; i < to; i++) indices.add(i);
    if (selection.range)
      for (let i = selection.range.start; i < selection.range.end; i++) indices.add(i);
    for (const id of retained.values()) {
      const i = blocks.findIndex((b) => b.id === id);
      if (i >= 0) indices.add(i);
    }
    let previous = -1;
    return [...indices]
      .sort((a, b) => a - b)
      .map((index) => {
        const before =
          index > previous + 1
            ? Math.max(0, window.offsetOf(index) - window.offsetOf(previous + 1) - gap)
            : 0;
        previous = index;
        return { block: blocks[index]!, index, before };
      });
  });
  const bottom = $derived(
    shown.length && shown.at(-1)!.index + 1 < blocks.length
      ? Math.max(0, window.offsetOf(blocks.length) - window.offsetOf(shown.at(-1)!.index + 1) - gap)
      : 0,
  );
  $effect(() => window.reset(blocks.map((block) => block.id)));
  $effect(() => {
    const el = root;
    const scroller = el?.closest<HTMLElement>('.scroller, .viewer');
    if (!el || !scroller || !virtual) return;
    let cancelFrame: (() => void) | undefined;
    const update = () => {
      cancelFrame = undefined;
      const offset = scroller.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const height = scroller.clientHeight;
      return () => window.update(offset, height);
    };
    const soon = () => {
      cancelFrame ??= layoutFrame(update);
    };
    const resize = new ResizeObserver(soon);
    resize.observe(scroller);
    scroller.addEventListener('scroll', soon, { passive: true });
    soon();
    return () => {
      resize.disconnect();
      cancelFrame?.();
      scroller.removeEventListener('scroll', soon);
    };
  });
  $effect(() => {
    if (!primary) return;
    const reveal = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const index = revealIndex?.(id) ?? blocks.findIndex((block) => block.id === id);
      const scroller = root?.closest<HTMLElement>('.scroller');
      if (index < 0 || !scroller) return;
      const offset = window.offsetOf(index);
      window.update(offset, scroller.clientHeight);
      scroller.scrollTop = offset;
      requestAnimationFrame(() =>
        document.getElementById(`proposal-${id}`)?.scrollIntoView({ block: 'center' }),
      );
    };
    root?.addEventListener('feed-reveal', reveal);
    feed.revealRow = (id) =>
      root?.dispatchEvent(new CustomEvent('feed-reveal', { detail: id, bubbles: true }));
    return () => {
      root?.removeEventListener('feed-reveal', reveal);
    };
  });
  $effect(() => {
    const el = root;
    if (!el) return;
    const retain = (event: Event) => {
      const { id, active } = (event as CustomEvent<{ id: string; active: boolean }>).detail;
      let child = event.target as HTMLElement;
      while (child.parentElement && child.parentElement !== el) child = child.parentElement;
      const block = child.dataset['feedBlock'];
      if (block && active) retained.set(id, block);
      else retained.delete(id);
    };
    el.addEventListener('feed-retain', retain);
    return () => el.removeEventListener('feed-retain', retain);
  });
</script>

<div class="virtual-blocks" bind:this={root} style:--virtual-gap={`${gap}px`}>
  {#each shown as { block, index, before } (block.id)}
    {#if virtual && before > 0}<div aria-hidden="true" style:height={`${before}px`}></div>{/if}
    <div
      class="virtual-block"
      data-feed-block={block.id}
      use:measureBlock={{ window, id: block.id, index, enabled: virtual }}
    >
      {@render children(block)}
    </div>
  {/each}
  {#if virtual && bottom > 0}<div aria-hidden="true" style:height={`${bottom}px`}></div>{/if}
</div>

<style>
  .virtual-blocks,
  .virtual-block {
    display: flex;
    flex-direction: column;
    gap: var(--virtual-gap, 14px);
    min-width: 0;
  }
  .virtual-blocks > div {
    flex: none;
  }
</style>
