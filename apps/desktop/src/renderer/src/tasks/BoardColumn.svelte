<script lang="ts">
  import { Checkbox, t } from '@skaro/ui';
  import BoardCard from './BoardCard.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  import { createBoardColumn, type BoardColumnProps } from './board-column.svelte';
  import { COLUMN_ICONS } from './column-icons';
  let p: BoardColumnProps = $props();
  const view = createBoardColumn(() => p);
  const Icon = $derived(COLUMN_ICONS[p.col.key]);
  export const revealSlot = (index: number) => view.revealSlot(index);
  export const revealCard = (id: string) => view.revealCard(id);
</script>

<div
  class="col"
  class:over={view.over}
  data-col={p.col.key}
  data-range-revision={p.col.range.revision}
>
  <div class="head">
    <span class="name" style="color: {p.col.color}">{t(`board.col.${p.col.key}`)}</span>
    <span class="count">{view.count + (view.slot >= 0 ? 1 : 0)}</span>
    {#if p.selecting}
      <span class="select-all"
        ><Checkbox
          label={t('board.selectAll')}
          bind:checked={
            () => view.allSelected,
            (on) => {
              if (p.col.range.source) p.onselectcolumn(p.col.range.source, on);
            }
          }
        /></span
      >
    {/if}
  </div>
  <div class="cards" data-scroll>
    {#if !p.col.range.source}
      <span class="fd-pulse"></span>
    {:else if view.count || view.slot >= 0}
      <WindowedContent
        bind:this={view.content}
        count={view.count + (view.slot >= 0 ? 1 : 0)}
        revision={view.revision}
        identity={p.col.range.identity}
        read={view.read}
        scroller="[data-scroll]"
        gap={7}
        estimate={100}
      >
        {#snippet children(entry)}
          {#if entry.task}
            {@const task = p.col.range.present(entry.task)}
            <div data-task-index={entry.index}>
              <BoardCard
                {task}
                now={p.now}
                selecting={p.selecting}
                selected={p.selection.has(task)}
                dropped={p.dnd.dropped === task.id}
                onselect={(on) => p.onselect(task.id, on, task)}
                onopen={() => p.onopen(task.id)}
                ondragstart={(e) => p.dnd.down(task, p.col.key, e)}
                onkey={(e) => p.dnd.keydown(task, p.col.key, e)}
              />
            </div>
          {:else}
            <div class="slot" style="height: {view.height}px"><span></span></div>
          {/if}
        {/snippet}
      </WindowedContent>
    {:else}
      <div class="empty">
        <span class="empty-icon"><Icon size={18} strokeWidth={1.8} /></span>
        <span class="empty-text">{t(`board.col.${p.col.key}.empty`)}</span>
      </div>
    {/if}
  </div>
</div>
