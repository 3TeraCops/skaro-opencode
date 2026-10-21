<script lang="ts">
  import { onMount } from 'svelte';
  import { Banner, t } from '@skaro/ui';
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Workspace from './C4Workspace.svelte';
  import C4Gallery from './C4Gallery.svelte';
  import LoadingView from '../screens/LoadingView.svelte';
  import './i18n';
  import '../graph/i18n';
  let {
    projectId,
    target,
    ongraph,
  }: {
    projectId: string;
    target?: { viewId: string; elementId?: string } | undefined;
    ongraph: (id: string, viewId: string) => void;
  } = $props();
  let model = $state.raw<C4Model | null>(),
    error = $state('');
  let opened = $state<{ viewId: string; elementId?: string }>();
  $effect(() => {
    if (target) opened = target;
  });
  onMount(() => {
    let disposed = false,
      revision = 0;
    let hash: string | undefined;
    const read = async () => {
      const serial = ++revision;
      try {
        const result = await window.skaro.invoke('graph.model', projectId);
        if (!disposed && serial === revision) {
          model = result;
          error = '';
        }
      } catch (reason) {
        if (!disposed && serial === revision) error = String(reason);
      }
    };
    void read();
    const off = window.skaro.on('graph.changed', (status) => {
      if (status.projectId === projectId && status.snapshot && status.snapshot.c4Hash !== hash) {
        hash = status.snapshot.c4Hash;
        void read();
      }
    });
    return () => {
      disposed = true;
      off();
    };
  });
</script>

{#if error}<Banner kind="error" text={error} />
{:else if model?.views.length}
  {#if opened}
    <C4Workspace
      {model}
      {projectId}
      target={opened}
      onclose={() => (opened = undefined)}
      {ongraph}
    />
  {:else}
    <C4Gallery {model} onopen={(viewId) => (opened = { viewId })} />
  {/if}
{:else if model === undefined}<LoadingView />
{:else}<Banner kind="info" text={t('graph.noC4')} />{/if}
