<script lang="ts">
  import type { Block } from './render';
  import type { DocumentProjection } from './projection.svelte';
  import DocBlock from './DocBlock.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  let {
    blocks = [],
    projection,
    copyText,
    onlink,
  }: {
    blocks?: Block[];
    projection?: DocumentProjection;
    copyText?: () => string;
    onlink: (href: string) => void;
  } = $props();
  let windowed = $state<{ reveal(index: number): Promise<void> }>();
  export async function reveal(index: number) {
    await windowed?.reveal(index);
  }
  function click(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-href]');
    if (!a) return;
    e.preventDefault();
    onlink(a.dataset['href'] ?? '');
  }
  import './doc-article.css';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div data-doc-article class="blocks" onclick={click}>
  {#if projection?.view}
    <WindowedContent
      bind:this={windowed}
      count={projection.view.count}
      revision={projection.view.revision}
      read={(start) => projection!.page(projection!.view!.revision, start)}
      {copyText}
    >
      {#snippet children(block)}<DocBlock value={block} />{/snippet}
    </WindowedContent>
  {:else if projection}<span class="fd-pulse"></span>
  {:else}
    {#each blocks as block, index (index)}<DocBlock value={block} />{/each}
  {/if}
</div>
