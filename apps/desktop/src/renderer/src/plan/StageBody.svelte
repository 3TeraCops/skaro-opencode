<script lang="ts">
  import { t } from '@skaro/ui';
  import StageRows from './StageRows.svelte';
  import type { MilestoneInfo } from '../../../shared/ipc';
  import type { StageController } from './stage-controller.svelte';
  let { model }: { model: StageController } = $props();
  let detail = $state<MilestoneInfo>();
  let rows = $state<StageRows>();
  $effect(() => {
    void model.p.data.version;
    const project = model.p.projectId,
      id = model.m.id;
    let cancelled = false;
    if (id)
      void window.skaro
        .invoke('plan.milestone', project, id)
        .then((value) => {
          if (!cancelled) detail = value;
        })
        .catch((error: unknown) => console.error('Plan milestone:', error));
    return () => {
      cancelled = true;
    };
  });
  export const reveal = (index: number) => rows?.reveal(index);
  export const revealTask = (id: string) => rows?.revealTask(id);
</script>

<div data-plan-stage class="body">
  {#if detail?.goal || detail?.criteria}
    <div data-plan-stage class="meta">
      <div data-plan-stage class="meta-col">
        <span data-plan-stage class="label">{t('plan.goal')}</span>
        <span data-plan-stage class="text">{detail?.goal ?? ''}</span>
      </div>
      <div data-plan-stage class="meta-col">
        <span data-plan-stage class="label">{t('plan.criteria')}</span>
        <span data-plan-stage class="text">{detail?.criteria ?? ''}</span>
      </div>
    </div>
  {/if}
  <StageRows bind:this={rows} {model} />
</div>
