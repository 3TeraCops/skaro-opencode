<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { changed } from './changed-rows';
  import type { HistorySource } from '../../../shared/history';
  import { proposalChanges } from '../../../shared/proposal-changes';
  import WindowedContent from '../WindowedContent.svelte';
  import './chat-changed-panel.css';
  import { useFeed } from '../feed/context.svelte';
  const feed = useFeed();
  let { timeline, history }: { timeline: TimelineState | undefined; history?: HistorySource } =
    $props();
  const paged = $derived(history?.changeCount !== undefined);
  const legacy = $derived(
    paged
      ? []
      : (timeline?.items ?? []).flatMap((item) =>
          item.kind === 'proposal' ? proposalChanges(item) : [],
        ),
  );
  const count = $derived(paged ? history!.changeCount! : legacy.length);
  async function read(start: number) {
    return paged
      ? window.skaro.invoke('history.changes', history!, start)
      : legacy.slice(start, start + 16);
  }
  function reveal(id: string): void {
    feed.revealRow?.(id);
    document
      .getElementById(`proposal-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div class="changed">
  <span class="sk-label changed-label">{t('chat.changed')}</span>
  <div class="changed-list">
    {#if count}
      <WindowedContent
        {count}
        revision={history?.changeRevision ?? history?.revision ?? 0}
        {read}
        scroller=".changed-list"
        gap={3}
        estimate={55}
      >
        {#snippet children(item)}
          {@const c = changed(item)}
          <button
            type="button"
            class="changed-row"
            data-proposal-id={item.itemId}
            data-tip={c.pending ? t('chat.changed.pending.tip') : t('chat.changed.open.tip')}
            onclick={() => reveal(item.itemId)}
          >
            <span class="changed-icon"><Icon name={c.icon} size={13} stroke={1.8} /></span>
            <span class="changed-texts">
              <span class="changed-title">{c.title}</span>
              <span class="changed-note" class:pending={c.pending}>{c.note}</span>
            </span>
          </button>
        {/snippet}
      </WindowedContent>
    {:else}
      <span class="changed-empty">{t('chat.changed.empty')}</span>
    {/if}
  </div>
</div>
