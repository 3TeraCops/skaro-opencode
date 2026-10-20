<script lang="ts">
  import { groupFeedRows, type FeedRow } from '@skaro/timeline';
  import './action-rows.css';
  import ActionGroup from './ActionGroup.svelte';
  import FeedRowView from './FeedRowView.svelte';
  import VirtualBlocks from './VirtualBlocks.svelte';
  import { feedText } from './feed-copy';

  /** Rows of a feed; the main feed and each subagent use it. */
  let {
    rows,
    waiting,
    nested = false,
  }: {
    rows: FeedRow[];
    /** Items with an open permission request (blue dot). */
    waiting: ReadonlySet<string>;
    nested?: boolean;
  } = $props();

  /**
   * The final answer of each finished turn: the turn summary carries its actions. Rows in between
   * (proposal cards, a reconnect notice) do not detach it; a user message starts another turn.
   */
  const replyOfEnd = $derived.by(() => {
    const map: Record<string, Extract<FeedRow, { type: 'agent' }>> = {};
    rows.forEach((row, i) => {
      if (row.type !== 'turn_end') return;
      for (let j = i - 1; j >= 0 && rows[j]!.type !== 'user' && rows[j]!.type !== 'turn_end'; j--) {
        const prev = rows[j]!;
        if (prev.type === 'agent') {
          if (prev.final) map[row.id] = prev;
          break;
        }
      }
    });
    return map;
  });
  const endsAfter = $derived(new Set(Object.values(replyOfEnd).map((reply) => reply.id)));
  const lastTurnEnd = $derived(rows.findLast((r) => r.type === 'turn_end')?.id);

  const blocks = $derived(groupFeedRows(rows));
</script>

{#snippet single(row: FeedRow)}
  <FeedRowView
    {row}
    {waiting}
    ended={endsAfter.has(row.id)}
    last={row.type === 'notice' ? row.id === rows.at(-1)?.id : row.id === lastTurnEnd}
    reply={replyOfEnd[row.id]}
  />
{/snippet}

<VirtualBlocks
  {blocks}
  threshold={8}
  primary={!nested}
  copyText={() => feedText(rows)}
  revealIndex={(id) =>
    blocks.findIndex(
      (block) =>
        block.id === id || (block.type === 'actions' && block.rows.some((row) => row.id === id)),
    )}
>
  {#snippet children(block)}
    {#if block.type === 'actions'}
      <ActionGroup group={block} {waiting}>
        {#snippet children(row)}{@render single(row)}{/snippet}
      </ActionGroup>
    {:else}
      {@render single(block.row)}
    {/if}
  {/snippet}
</VirtualBlocks>
