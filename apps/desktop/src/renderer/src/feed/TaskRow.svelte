<script lang="ts">
  import type { HistoryRow } from '../../../shared/history';
  import { t, tn } from '@skaro/ui';
  import Chevron from './Chevron.svelte';
  import { clock, useFeed } from './context.svelte';
  const feed = useFeed();
  import FeedRows from './FeedRows.svelte';
  import PagedFeedRows from './PagedFeedRows.svelte';
  import { clock as formatClock } from './format';

  /** "↳ Субагент: описание · 14 действий · 0:40", opening into its own feed (mockup 1a). */
  let {
    row,
    waiting,
  }: { row: Extract<HistoryRow, { type: 'task' }>; waiting: ReadonlySet<string> } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(feed.rowState?.get(`open:${row.id}`) ?? false);
  $effect(() => {
    feed.rowState?.set(`open:${row.id}`, open);
  });
  const running = $derived(row.item.status === 'running');
  const elapsed = $derived(
    (row.item.endedAt ?? (running ? clock.now : row.item.startedAt)) - row.item.startedAt,
  );
  const summary = $derived(row.item.summary?.trim());
</script>

<div class="fd-block gap6">
  <button
    type="button"
    class="fd-task-row"
    data-tip={running ? t('feed.task.working') : t('feed.task.tip')}
    onclick={() => (open = !open)}
  >
    <span class="arrow">↳</span>
    <span class="title">{row.item.title}</span>
    {#if running}
      <span class="meta"><span class="fd-pulse"></span>{formatClock(elapsed)}</span>
    {:else}
      <span class="meta">{tn('feed.actions', row.actions)} · {formatClock(elapsed)}</span>
    {/if}
    <Chevron {open} color="var(--sk-text-25)" />
  </button>
  {#if open}
    <div class="fd-nested">
      {#if row.history}<PagedFeedRows source={row.history} {waiting} nested />
      {:else}<FeedRows rows={row.children} {waiting} nested />{/if}
      {#if summary && !(row.hasAgentReply ?? row.children.some((c) => c.type === 'agent'))}
        <div class="fd-text">{summary}</div>
      {/if}
    </div>
  {/if}
</div>
