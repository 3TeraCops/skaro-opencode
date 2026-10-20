<script lang="ts">
  import type { HistorySource } from '../../../shared/history';
  import PagedBlocks from './PagedBlocks.svelte';
  import FeedRowView from './FeedRowView.svelte';
  import ActionGroup from './ActionGroup.svelte';
  let {
    source,
    waiting,
    nested = false,
    initial,
  }: {
    source: HistorySource;
    waiting: ReadonlySet<string>;
    nested?: boolean;
    initial?: import('../../../shared/history').HistoryPage;
  } = $props();
</script>

<PagedBlocks {source} {initial} primary={!nested}>
  {#snippet children(block)}
    {#if block.type === 'actions'}
      <ActionGroup
        group={block}
        {waiting}
        history={block.history}
        presentation={block.presentation}
      >
        {#snippet children(row)}<FeedRowView {row} {waiting} />{/snippet}
      </ActionGroup>
    {:else}
      <FeedRowView
        row={block.row}
        {waiting}
        ended={block.presentation?.ended}
        last={block.presentation?.last}
        reply={block.presentation?.reply}
      />
    {/if}
  {/snippet}
</PagedBlocks>
