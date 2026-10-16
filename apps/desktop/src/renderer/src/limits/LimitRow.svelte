<script lang="ts">
  import type { AgentLimitWindow } from '@skaro/timeline';
  import { i18n, Progress, t } from '@skaro/ui';
  let {
    kind,
    window,
  }: {
    kind: AgentLimitWindow['kind'];
    window?: AgentLimitWindow;
  } = $props();
  const remaining = $derived(window?.remainingPercent);
  const percent = $derived(
    typeof remaining === 'number'
      ? new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(remaining) + '%'
      : '—',
  );
  const reset = $derived(
    window?.resetsAt
      ? new Intl.DateTimeFormat(i18n.locale, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(window.resetsAt))
      : undefined,
  );
</script>

<div class="limit-row">
  <div class="heading">
    <span class="label">{t(`limits.${kind}`)}</span>
    <span class="percent">{percent}</span>
  </div>
  {#if typeof remaining === 'number'}
    <Progress done={remaining} total={100} accessibleLabel={t(`limits.${kind}`)} />
  {/if}
  <span class="reset">{reset ? t('limits.reset', { time: reset }) : t('limits.unknownReset')}</span>
</div>

<style>
  .limit-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    color: var(--sk-text-6);
    font-size: var(--sk-fs-6);
    font-weight: 600;
  }
  .percent {
    color: var(--sk-text-bright);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-14);
  }
  .reset {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }
</style>
