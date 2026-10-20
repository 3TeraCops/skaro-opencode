<script lang="ts">
  import AssignDialog from './AssignDialog.svelte';
  import Board from './Board.svelte';
  import BulkDialog from './BulkDialog.svelte';
  import List from './List.svelte';
  import RunDialog from './RunDialog.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import TasksHeader from './TasksHeader.svelte';
  import TasksEmpty from './TasksEmpty.svelte';
  import './i18n';
  import type { TasksProps } from './tasks-props';
  import { createTasksController } from './tasks-controller.svelte';
  import { createBoardMoves } from './board-moves-controller.svelte';
  let { projectId, data, onopen, onnew }: TasksProps = $props();
  const state = createTasksController({
    get projectId() {
      return projectId;
    },
    get data() {
      return data;
    },
    get onopen() {
      return onopen;
    },
    get onnew() {
      return onnew;
    },
  });
  const moves = createBoardMoves({
    projectId: () => projectId,
    get data() {
      return data;
    },
    filters: () => state.filters,
    onopen: (id) => onopen(id),
    run: (ids, message, assignment) => data.run(ids, message, assignment),
  });

  import './tasks-screen.css';
</script>

<div data-task-tasks-screen class="screen">
  <TasksHeader {state} />

  {#if data.loaded && (state.facets?.total ?? 0) === 0}
    <TasksEmpty {onnew} />
  {:else if state.view === 'board'}
    <Board
      {moves}
      selection={state.selection}
      selecting={state.selecting}
      now={state.now}
      onselect={state.select}
      onselectcolumn={state.selectColumn}
      {onopen}
    />
  {:else}
    <List
      range={state.list}
      selection={state.selection}
      selecting={state.selecting}
      now={state.now}
      onselect={state.select}
      {onopen}
    />
  {/if}

  {#if state.picked.length}
    <SelectionBar
      selected={state.picked}
      onaction={state.action}
      onclear={() => (state.selected = [])}
    />
  {/if}
</div>

{#if moves.starting}
  <RunDialog
    {projectId}
    tasks={[moves.starting]}
    onconfirm={moves.confirmStart}
    onclose={moves.closeStart}
  />
{:else if state.dialog === 'assign'}
  <AssignDialog
    {projectId}
    count={state.picked.length}
    onconfirm={state.assign}
    onclose={() => (state.dialog = undefined)}
  />
{:else if state.dialog}
  <BulkDialog
    kind={state.dialog}
    tasks={state.picked}
    milestones={data.milestones}
    onconfirm={state.bulk}
    onclose={() => (state.dialog = undefined)}
  />
{/if}
