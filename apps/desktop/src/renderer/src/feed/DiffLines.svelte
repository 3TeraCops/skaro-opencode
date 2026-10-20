<script lang="ts">
  import type { FileRow } from '@skaro/timeline';
  import WindowedContent from '../WindowedContent.svelte';
  import DiffText from './DiffText.svelte';
  import { useFeed } from './context.svelte';
  import { createInlineDiff } from './inline-diff.svelte';
  let { row }: { row: Pick<FileRow, 'diffs' | 'change'> } = $props();
  let node = $state<HTMLDivElement>();
  const feed = useFeed();
  const view = createInlineDiff({
    node: () => node,
    row: () => row,
    onerror: (error) => feed.historyError?.(error),
  });
</script>

<div class="fd-diff" bind:this={node}>
  <div style:min-width={view.metadata ? `${view.metadata.width + 32}px` : undefined}>
    {#key view.metadata?.height}
      <WindowedContent
        count={view.metadata?.count ?? 1}
        revision={view.revision}
        read={view.read}
        scroller=".fd-diff"
        gap={0}
        overscan={200}
        estimate={view.metadata?.height ?? 20}
      >
        {#snippet children({ entry, textView })}
          {#if entry.kind === 'sep'}
            <div style="display: flow-root"><div class="fd-diff-sep"></div></div>
          {:else}
            <div class="fd-diff-line {entry.kind}">
              <span class="sign">{entry.sign}</span><DiffText text={entry.text} create={textView} />
            </div>
          {/if}
        {/snippet}
      </WindowedContent>
    {/key}
  </div>
</div>
