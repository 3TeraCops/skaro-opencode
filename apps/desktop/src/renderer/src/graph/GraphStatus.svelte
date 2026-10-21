<script lang="ts">
  import { Banner, Button, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  let { model }: { model: ProjectGraph } = $props();
  const busy = $derived(
    model.status && ['queued', 'indexing', 'stale'].includes(model.status.phase),
  );
</script>

{#if model.error}<div class="graph-alert">
    <Banner kind="error" text={model.error} onclose={() => (model.error = '')} />
  </div>{/if}
{#if model.playback.phase === 'invalidated'}
  <div class="graph-notice">
    <Banner kind="info" text={t('graph.invalidated')} /><Button
      size="sm"
      disabled={model.status?.snapshot?.id === model.snapshot?.id}
      onclick={() => {
        void model.latest();
      }}>{t('graph.loadLatest')}</Button
    >
  </div>
{:else if model.playback.phase === 'error'}<div class="graph-alert">
    <Banner kind="error" text={model.playback.scenario?.diagnostics.join('; ') ?? ''} />
  </div>{/if}
{#if busy}
  <div class="graph-notice">
    <Banner
      kind="info"
      text={t(model.snapshot ? 'graph.refreshing' : 'graph.building', {
        done: model.status?.progress?.done ?? 0,
        total: model.status?.progress?.total ?? 0,
      })}
    />
    <Button
      variant="ghost"
      size="sm"
      onclick={() => {
        void window.skaro.invoke('graph.cancel', model.projectId);
      }}>{t('graph.cancel')}</Button
    >
  </div>
{:else if model.status && ['error', 'unavailable', 'cancelled'].includes(model.status.phase)}
  <div class="graph-notice">
    <Banner
      kind={model.status.phase === 'cancelled' ? 'info' : 'error'}
      text={model.status.error ?? t(`graph.phase.${model.status.phase}`)}
    />
    <Button
      size="sm"
      onclick={() => {
        void window.skaro
          .invoke('graph.rebuild', model.projectId)
          .catch((error) => (model.error = String(error)));
      }}>{t('graph.rebuild')}</Button
    >
  </div>
{/if}
