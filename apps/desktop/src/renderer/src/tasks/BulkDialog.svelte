<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import { untrack } from 'svelte';
  import WindowedContent from '../WindowedContent.svelte';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import Dialog from './Dialog.svelte';
  import { statusLabel, type BulkKind } from './model';

  /** Confirmation of a bulk action with the list of tasks it touches (Tasks mockup). */
  let {
    kind,
    tasks,
    milestones,
    onconfirm,
    onclose,
  }: {
    kind: BulkKind;
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    /** `milestone` — the target of "Перенести". */
    onconfirm: (milestone?: string) => void;
    onclose: () => void;
  } = $props();

  import { BULK_LOOK as LOOK } from './bulk-appearance';

  const shown = $derived(kind === 'unblock' ? tasks.filter((x) => x.status === 'blocked') : tasks);
  let revision = $state(0);
  $effect(() => {
    void shown;
    untrack(() => revision++);
  });
  const read = async (start: number) => shown.slice(start, start + 16);
  const copyText = () =>
    shown.map((task) => `${task.id} · ${task.title} · ${note(task)}`).join('\n');
  const title = $derived(
    kind === 'unblock'
      ? t('board.dlg.unblock', { n: shown.length })
      : tn(`board.dlg.${kind}`, tasks.length),
  );
  const action = $derived(kind === 'unblock' ? t('board.unblock') : t(`board.dlg.${kind}.action`));
  const look = $derived(LOOK[kind]);
  // svelte-ignore state_referenced_locally
  let target = $state(milestones.at(-1)?.id ?? '');

  function note(task: TaskSummary): string {
    if (kind === 'move') return task.milestone?.id ?? '—';
    if (task.status === 'blocked') return t('board.waits', { deps: task.waitsFor.join(', ') });
    return statusLabel(task.status);
  }

  import './bulk-dialog.css';
</script>

<Dialog width={428} {onclose}>
  <div data-task-bulk-dialog class="top">
    <span data-task-bulk-dialog class="badge" style="background: {look.bg}; color: {look.color}"
      ><Icon name={look.icon} size={17} stroke={1.9} /></span
    >
    <div data-task-bulk-dialog class="texts">
      <div data-task-bulk-dialog class="title">{title}</div>
      <div data-task-bulk-dialog class="text">{t(`board.dlg.${kind}.text`)}</div>
    </div>
  </div>

  <div data-task-bulk-dialog class="tasks">
    <WindowedContent
      count={shown.length}
      {revision}
      {read}
      {copyText}
      scroller=".tasks[data-task-bulk-dialog]"
      gap={0}
      estimate={33}
    >
      {#snippet children(task)}
        <div data-task-bulk-dialog class="task">
          <span data-task-bulk-dialog class="id">{task.id}</span>
          <span data-task-bulk-dialog class="name">{task.title}</span>
          <span data-task-bulk-dialog class="note" class:blocked={task.status === 'blocked'}
            >{note(task)}</span
          >
        </div>
      {/snippet}
    </WindowedContent>
  </div>

  {#if kind === 'move'}
    <div data-task-bulk-dialog class="targets">
      <span data-task-bulk-dialog class="label">{t('board.move')}</span>
      {#each milestones as m (m.id)}
        <div
          data-task-bulk-dialog
          class="target"
          class:on={target === m.id}
          role="radio"
          aria-checked={target === m.id}
          tabindex="0"
          onclick={() => (target = m.id)}
          onkeydown={(e) => e.key === 'Enter' && (target = m.id)}
        >
          <span data-task-bulk-dialog class="radio"></span>
          <span data-task-bulk-dialog class="id">{m.id}</span>
          <span data-task-bulk-dialog class="name">{m.title}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div data-task-bulk-dialog class="footer">
    <span data-task-bulk-dialog class="hint">{t(`board.dlg.${kind}.hint`)}</span>
    <button data-task-bulk-dialog type="button" class="cancel" onclick={onclose}
      >{t('ui.cancel')}</button
    >
    <button
      data-task-bulk-dialog
      type="button"
      class="confirm"
      style="background: {look.btn}"
      disabled={kind === 'move' && !target}
      onclick={() => onconfirm(kind === 'move' ? target : undefined)}>{action}</button
    >
  </div>
</Dialog>
