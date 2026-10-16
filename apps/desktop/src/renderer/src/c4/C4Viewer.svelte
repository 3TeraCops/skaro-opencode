<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { Banner, ViewerModal, TooltipHost } from '@skaro/ui';
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Canvas from './C4Canvas.svelte';
  import C4Details from './C4Details.svelte';
  import C4ViewerToolbar from './C4ViewerToolbar.svelte';
  import { createC4Viewer } from './viewer-state.svelte';
  import './viewer.css';
  import './i18n';
  let {
    model,
    initialView,
    onclose,
  }: { model: C4Model; initialView: string; onclose: () => void } = $props();
  let dialog = $state<HTMLDivElement>();
  // svelte-ignore state_referenced_locally
  const viewer = createC4Viewer(() => model, initialView, onclose);
  onMount(() => viewer.attach(dialog!));
</script>

<svelte:document onfullscreenchange={viewer.fullscreenChanged} />
<ViewerModal
  class="c4-viewer-dialog"
  bind:element={dialog}
  label={viewer.view.title}
  expanded
  onclose={() => void viewer.close()}
>
  <div class="c4-viewer">
    <C4ViewerToolbar state={viewer} />
    {#if viewer.error}<Banner
        kind="error"
        text={viewer.error}
        onclose={() => (viewer.error = '')}
      />{/if}
    <div class="content">
      {#key viewer.view.id}<SvelteFlowProvider
          ><C4Canvas
            {model}
            view={viewer.view}
            selected={viewer.selected}
            focusRequest={viewer.focusRequest}
            onselect={(id) => (viewer.selected = id)}
            ondrill={viewer.drill}
          /></SvelteFlowProvider
        >{/key}
      {#if viewer.selected}<C4Details
          model={viewer.displayed}
          planned={viewer.view.state === 'planned' &&
            [...model.elements, ...model.relationships].some(
              (e) => e.id === viewer.selected && !!e.planned,
            )}
          selected={viewer.selected}
          canDrill={viewer.canDrill(viewer.selected)}
          onselect={(id) => (viewer.selected = id)}
          ondrill={viewer.drill}
        />{/if}
    </div>
    {#if viewer.fullscreen}<TooltipHost />{/if}
  </div>
</ViewerModal>
