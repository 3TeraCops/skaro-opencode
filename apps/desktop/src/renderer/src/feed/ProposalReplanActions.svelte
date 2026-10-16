<script lang="ts">
  import { Banner, Icon, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import { replanStatus } from './proposal-replan';

  let { state }: { state: ProposalState } = $props();
  const item = $derived(state.item);
  const progress = $derived(item.result?.replan);
  const failed = $derived(item.state === 'accepted' && !!progress?.error);
  const settled = $derived(item.state === 'applied' || item.state === 'reverted');
</script>

{#if failed && !state.busy}
  <Banner kind="error" text={progress?.error} />
{/if}
<div class="foot">
  <span class="hint" role="status">{replanStatus(item, state.replanRequest)}</span>
  <button type="button" class="btn" onclick={() => (state.viewer = true)}
    ><Icon name="eye" size={13} stroke={2} />{t('proposal.open')}</button
  >
  {#if settled && state.feed.openSection}
    <button type="button" class="btn" onclick={() => state.feed.openSection?.('tasks')}
      >{t('proposal.replan.openTasks')}</button
    >
  {/if}
  {#if state.actionable && failed && progress}
    <button
      type="button"
      class="btn primary"
      disabled={state.busy}
      onclick={() => void state.decide({ action: progress!.operation })}
      >{t('proposal.replan.retry')}</button
    >
    {#if progress.operation === 'apply'}
      <button
        type="button"
        class="btn"
        disabled={state.busy}
        onclick={() => void state.decide({ action: 'revert' })}
        ><Icon name="undo" size={13} stroke={2} />{t('proposal.revert')}</button
      >
    {/if}
  {:else if state.actionable && item.state === 'pending'}
    <button
      type="button"
      class="btn"
      disabled={state.busy}
      onclick={() => void state.decide({ action: 'reject' })}
      ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
    >
    <button
      type="button"
      class="btn primary"
      disabled={state.busy}
      onclick={() => void state.decide({ action: 'apply' })}
      ><Icon name="check" size={13} stroke={2.4} />{t('proposal.apply')}</button
    >
  {:else if state.actionable && item.state === 'applied'}
    <button
      type="button"
      class="btn"
      disabled={state.busy}
      onclick={() => void state.decide({ action: 'revert' })}
      ><Icon name="undo" size={13} stroke={2} />{t('proposal.revert')}</button
    >
  {/if}
</div>
