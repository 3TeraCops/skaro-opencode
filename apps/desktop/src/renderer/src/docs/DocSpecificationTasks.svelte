<script lang="ts">
  import { t } from '@skaro/ui';
  import WindowedContent from '../WindowedContent.svelte';
  import type { TaskRangeState } from '../tasks/range.svelte';
  import { taskDot } from './header-task-dot';
  import type { HeaderProps } from './header-props';
  let {
    tasks,
    range,
    ontask,
  }: {
    tasks: NonNullable<HeaderProps['tasks']>;
    range?: TaskRangeState;
    ontask: HeaderProps['ontask'];
  } = $props();
  const count = $derived(range?.count ?? tasks.length);
  const done = $derived(
    range ? (range.source?.done ?? 0) : tasks.filter((x) => x.status === 'done').length,
  );
  const read = async (start: number) =>
    range
      ? (await range.read(start)).flatMap((entry) => (entry.kind === 'task' ? [entry.task] : []))
      : tasks.slice(start, start + 16);
</script>

<div data-doc-header class="spec-tasks">
  <div data-doc-header class="spec-tasks-head">
    <span data-doc-header class="sk-label">{t('docs.spec.tasks')}</span>
    <span data-doc-header class="spec-tasks-done"
      >{t('docs.spec.tasks.done', { n: done, of: count })}</span
    >
  </div>
  <div data-doc-header class="spec-tasks-list">
    <WindowedContent
      {count}
      revision={range?.revision ?? 0}
      {read}
      scroller=".page"
      gap={0}
      estimate={34}
    >
      {#snippet children(task)}
        {@const dot = taskDot(task.status)}
        <button
          data-doc-header
          type="button"
          class="spec-task"
          data-tip={t('docs.spec.task.tip')}
          onclick={() => ontask(task.id)}
        >
          <span data-doc-header class="spec-task-id">{task.id}</span>
          <span data-doc-header class="spec-task-title" class:done={task.status === 'done'}
            >{task.title}</span
          >
          <span data-doc-header class="spec-task-status"
            ><span
              data-doc-header
              class="dot"
              class:pulse={dot.pulse}
              style="background: {dot.color}"
            ></span>{t(`task.status.${task.status}`)}</span
          >
        </button>
      {/snippet}
    </WindowedContent>
  </div>
</div>
