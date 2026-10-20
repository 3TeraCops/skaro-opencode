<script lang="ts" generics="Block extends { id: string }">
  import type { Snippet } from 'svelte';
  import { createWindowedContent } from './windowed-controller.svelte';
  let {
    count,
    revision,
    identity,
    read,
    children,
    copyText,
    scroller = '.page',
    gap = 14,
    estimate = 120,
    overscan = 1000,
  }: {
    count: number;
    revision: number;
    /** Same query: retain live DOM until refreshed pages replace its data. */
    identity?: string;
    read: (start: number) => Promise<readonly Block[]>;
    children: Snippet<[Block]>;
    copyText?: () => string;
    scroller?: string;
    gap?: number;
    estimate?: number;
    overscan?: number;
  } = $props();
  const view = createWindowedContent({
    get count() {
      return count;
    },
    get revision() {
      return revision;
    },
    get identity() {
      return identity;
    },
    get read() {
      return read;
    },
    get copyText() {
      return copyText;
    },
    get scroller() {
      return scroller;
    },
    get gap() {
      return gap;
    },
    get overscan() {
      return overscan;
    },
    get estimate() {
      return estimate;
    },
  });
  const measure = (element: HTMLElement, index: number) => view.measure(element, index);
  export const reveal = (index: number) => view.reveal(index);
</script>

<div class="windowed-content" bind:this={view.root} style:gap={`${gap}px`}>
  {#each view.shown as { index, block, before } (index)}
    {#if before > 0}<div aria-hidden="true" style:height={`${before}px`}></div>{/if}
    <div data-feed-block={String(index)} use:measure={index}>
      {#if block}{#key block.id}{@render children(block)}{/key}{:else}<div
          class="pending"
          style:height={`${view.range.estimate}px`}
        >
          <span class="fd-pulse"></span>
        </div>{/if}
    </div>
  {/each}
  {#if view.bottom > 0}<div aria-hidden="true" style:height={`${view.bottom}px`}></div>{/if}
</div>

<style>
  .windowed-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .windowed-content > div {
    flex: none;
    min-width: 0;
  }
  .pending {
    display: grid;
    place-items: center;
  }
</style>
