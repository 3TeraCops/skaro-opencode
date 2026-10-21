<script lang="ts">
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { Banner, TooltipHost } from '@skaro/ui';
  import C4Canvas from './C4Canvas.svelte';
  import C4Details from './C4Details.svelte';
  import C4ViewerToolbar from './C4ViewerToolbar.svelte';
  import type { C4ViewerState } from './viewer-state.svelte';
  let {
    viewer,
    element = $bindable(),
    ongraph,
  }: {
    viewer: C4ViewerState;
    element?: HTMLDivElement;
    ongraph?: ((id: string, viewId: string) => void) | undefined;
  } = $props();
</script>

<div class="c4-viewer" bind:this={element}>
  <C4ViewerToolbar state={viewer} {ongraph} />
  {#if viewer.error}<Banner
      kind="error"
      text={viewer.error}
      onclose={() => (viewer.error = '')}
    />{/if}
  <div class="content">
    {#key viewer.view.id}<SvelteFlowProvider
        ><C4Canvas
          model={viewer.model}
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
          [...viewer.model.elements, ...viewer.model.relationships].some(
            (item) => item.id === viewer.selected && !!item.planned,
          )}
        selected={viewer.selected}
        canDrill={viewer.canDrill(viewer.selected)}
        onselect={(id) => (viewer.selected = id)}
        ondrill={viewer.drill}
      />{/if}
  </div>
  {#if viewer.fullscreen}<TooltipHost />{/if}
</div>
