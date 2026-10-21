<script lang="ts">
  import { onMount } from 'svelte';
  import { Banner, t } from '@skaro/ui';
  import { readC4Model, validateC4Model, type C4Model } from '@skaro/core/c4-view';
  import C4Viewer from '../c4/C4Viewer.svelte';
  import GraphPreview from './GraphPreview.svelte';
  import '../c4/i18n';
  let {
    projectId,
    destination,
    onclose,
  }: { projectId: string; destination: string; onclose: () => void } = $props();
  let model = $state.raw<C4Model>();
  let error = $state('');
  onMount(() => {
    void window.skaro
      .invoke('docs.read', projectId, '.skaro/architecture.md')
      .then((source) => {
        const payload = /```skaro-c4\s*\n([\s\S]*?)\n```/.exec(source);
        if (!payload) throw new Error('The architecture has no accepted C4 projection.');
        const parsed = readC4Model(JSON.parse(payload[1]!).model);
        const errors = validateC4Model(parsed);
        if (errors.length) throw new Error(errors.join('; '));
        model = parsed;
      })
      .catch((reason) => (error = String(reason)));
  });
</script>

{#if error}<Banner kind="error" text={t('graph.error', { error })} />
{:else if model}
  <GraphPreview {model} />
  {#if destination === 'c4'}
    <C4Viewer
      {model}
      initialView={model.views.find((v) => v.kind === 'container' && v.state === 'current')!.id}
      {onclose}
    />
  {/if}
{/if}
