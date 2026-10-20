<script lang="ts">
  import { tick } from 'svelte';
  import BoardCard from './BoardCard.svelte';
  import { createBoardDrag } from './board-drag.svelte';
  import type { BoardMoves } from './board-moves-controller.svelte';
  import BoardColumn from './BoardColumn.svelte';
  import type { ColumnKey } from './board-moves';
  import './board.css';

  /**
   * "Доска": four status columns, each scrolling on its own (Tasks mockup). Cards are dragged
   * within a column (order) and between columns (start, take back, merge; Skaro UI v2 mockup).
   */
  let {
    moves,
    selection,
    selecting,
    now,
    onselect,
    onselectcolumn,
    onopen,
  }: {
    moves: BoardMoves;
    selection: import('./task-selection.svelte').TaskSelection;
    selecting: boolean;
    now: number;
    onselect: (id: string, on: boolean, task?: import('../../../shared/ipc').TaskSummary) => void;
    onselectcolumn: (range: import('../../../shared/task-catalog').TaskRange, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  const views: Partial<Record<ColumnKey, BoardColumn>> = {};
  const dnd = createBoardDrag({
    reveal: (key, index) => views[key]?.revealSlot(index),
    revealCard: async (id) => {
      await moves.ready();
      await tick();
      await Promise.all(moves.columns.map((col) => col.range.ready()));
      await Promise.all(Object.values(views).map((view) => view?.revealCard(id)));
    },
    root: () => root,
    columns: () => moves.columns.map((col) => ({ key: col.key, count: col.range.count })),
    allowed: (task, from, to) => moves.allowed(task, from, to),
    ondrop: (task, from, to, index) => moves.drop(task, from, to, index),
  });
  const drag = $derived(dnd.drag);
</script>

<div class="board" bind:this={root}>
  {#each moves.columns as col (col.key)}
    <BoardColumn
      bind:this={views[col.key]}
      {col}
      {dnd}
      {selection}
      {selecting}
      {now}
      {onselect}
      {onselectcolumn}
      {onopen}
    />
  {/each}
  {#if drag && !drag.keyboard}
    <div
      class="col ghost-col"
      style="left: {drag.x - drag.ox}px; top: {drag.y - drag.oy}px; width: {drag.w}px"
    >
      <div class="cards">
        <BoardCard task={drag.task} {now} {selecting} selected={selection.has(drag.task)} ghost />
      </div>
    </div>
  {/if}
  <div class="live" aria-live="assertive">{dnd.live}</div>
</div>
