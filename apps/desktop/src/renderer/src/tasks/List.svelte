<script lang="ts">
  import WindowedContent from '../WindowedContent.svelte';
  import { t } from '@skaro/ui';
  import type { TaskRangeState } from './range.svelte';
  import TaskListRow from './TaskListRow.svelte';

  /** "Список": tasks grouped by milestone, one row per task (Tasks mockup). */
  let {
    range,
    selection,
    selecting,
    now,
    onselect,
    onopen,
  }: {
    range: TaskRangeState;
    selection: import('./task-selection.svelte').TaskSelection;
    /** "Выбрать несколько": rows get the checkbox column and a click selects. */
    selecting: boolean;
    now: number;
    onselect: (id: string, on: boolean, task?: import('../../../shared/ipc').TaskSummary) => void;
    onopen: (id: string) => void;
  } = $props();

  import './list.css';
</script>

<div data-task-list class="list" class:selecting>
  <div data-task-list class="grid head">
    {#if selecting}<div data-task-list></div>{/if}
    <div data-task-list>{t('board.col.id')}</div>
    <div data-task-list>{t('board.col.title')}</div>
    <div data-task-list>{t('board.col.status')}</div>
    <div data-task-list>{t('board.col.agent')}</div>
    <div data-task-list>{t('board.col.deps')}</div>
    <div data-task-list class="right">{t('board.col.updated')}</div>
  </div>
  <WindowedContent
    count={range.count}
    revision={range.revision}
    identity={range.identity}
    read={range.read}
    scroller=".list[data-task-list]"
    gap={0}
    estimate={44}
  >
    {#snippet children(entry)}
      {#if entry.kind === 'header'}
        {@const group = entry.group}
        <div data-task-list class="group-head">
          {#if group.id}<span data-task-list class="ms-id">{group.id}</span>{/if}
          <span data-task-list class="ms-name">{group.id ? group.title : t('board.loose')}</span>
          <span data-task-list class="ms-count"
            >{t('projects.ofTotal', { done: group.done, total: group.total })}</span
          >
          <div data-task-list class="line"></div>
        </div>
      {:else}
        <div
          data-task-list
          class="rows"
          style:border-radius={entry.first
            ? entry.last
              ? '9px'
              : '9px 9px 0 0'
            : entry.last
              ? '0 0 9px 9px'
              : '0'}
          style:margin-bottom={entry.last ? '14px' : '0'}
        >
          <TaskListRow
            task={range.present(entry.task)}
            on={selection.has(entry.task)}
            {selecting}
            {now}
            onselect={(id, on) => onselect(id, on, entry.task)}
            {onopen}
          />
        </div>
      {/if}
    {/snippet}
  </WindowedContent>
</div>
