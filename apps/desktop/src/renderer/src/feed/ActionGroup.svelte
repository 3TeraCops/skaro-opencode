<script lang="ts">
  import {
    actionGroupDiffStats,
    actionGroupSummary,
    dominantAction,
    actionGroupState,
    type ActionGroup,
    type ActionRow,
    type FeedBlock,
  } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import './action-groups-i18n';
  import ActionIcon from './ActionIcon.svelte';
  import DiffBadge from './DiffBadge.svelte';
  import { useFeed } from './context.svelte';
  import VirtualBlocks from './VirtualBlocks.svelte';
  import PagedBlocks from './PagedBlocks.svelte';
  import type { HistoryBlock, HistorySource } from '../../../shared/history';
  const feed = useFeed();

  let {
    group,
    waiting,
    children,
    history,
    presentation,
  }: {
    group: ActionGroup;
    waiting: ReadonlySet<string>;
    children: Snippet<[ActionRow]>;
    history?: HistorySource;
    presentation?: HistoryBlock['presentation'];
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(feed.rowState?.get(`open:${group.id}`) ?? false);
  $effect(() => {
    feed.rowState?.set(`open:${group.id}`, open);
  });
  const status = $derived(presentation?.state ?? actionGroupState(group, waiting));
  const parts = $derived(presentation?.parts ?? actionGroupSummary(group));
  const kind = $derived(dominantAction(parts));
  const diff = $derived(presentation?.diff ?? actionGroupDiffStats(group));
  const caption = $derived(
    parts
      .map((part, i) => {
        const state = part.running
          ? 'running'
          : part.pending || !part.performed
            ? 'pending'
            : 'done';
        const text =
          t(`feed.group.${part.kind}.${state}`) +
          (part.progress ? ` ${part.progress.attempt}/${part.progress.max}` : '');
        return i ? text[0]!.toLocaleLowerCase() + text.slice(1) : text;
      })
      .join(' '),
  );
  const listId = $derived(`${group.id}-list`);
  const blocks = $derived<FeedBlock[]>(group.rows.map((row) => ({ type: 'row', id: row.id, row })));
</script>

<div class="fd-block gap4" data-action-group={kind}>
  <button
    type="button"
    class="fd-fold fd-action-summary"
    aria-expanded={open}
    aria-controls={listId}
    onclick={() => (open = !open)}
  >
    <ActionIcon {kind} />
    <span>{caption}</span>
    {#if diff}<DiffBadge added={diff.added} removed={diff.removed} />{/if}
    {#if status.waiting}<span class="fd-wait-dot" title={t('feed.waiting')}></span>{/if}
    {#if status.running}<span class="fd-pulse"></span>{/if}
    {#if status.declined}<span class="fd-meta">{t('feed.cmd.declined')}</span>{/if}
    {#if status.interrupted}<span class="fd-meta">{t('feed.cmd.interrupted')}</span>{/if}
  </button>
  {#if open}
    <div class="fd-sublist" id={listId}>
      {#snippet renderAction(block: FeedBlock)}{#if block.type === 'row'}{@render children(
            block.row as ActionRow,
          )}{/if}{/snippet}
      {#if history}<PagedBlocks source={history} gap={0} children={renderAction} />
      {:else}<VirtualBlocks {blocks} gap={0} children={renderAction} />{/if}
    </div>
  {/if}
</div>
