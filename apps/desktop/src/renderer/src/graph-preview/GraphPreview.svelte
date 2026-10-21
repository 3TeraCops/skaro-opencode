<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Banner, t } from '@skaro/ui';
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Details from '../c4/C4Details.svelte';
  import C4CanvasTools from '../c4/C4CanvasTools.svelte';
  import GraphToolbar from './GraphToolbar.svelte';
  import { projectGraph } from './projection';
  import { LiveGraph } from './live-graph';
  import '../c4/viewer.css';
  import './preview.css';
  import './i18n';
  let { model: source }: { model: C4Model } = $props();
  // This preview is mounted for one immutable accepted model.
  // svelte-ignore state_referenced_locally
  const { model, graph } = projectGraph(source);
  let surface: HTMLDivElement, host: HTMLDivElement, effects: HTMLCanvasElement;
  let live = $state.raw<LiveGraph>();
  let selected = $state(''),
    view = $state('overview'),
    motion = $state(true),
    flow = $state(true),
    zoom = $state(1),
    error = $state('');
  $effect(() => {
    if (live) {
      live.motion = motion;
      live.flow = flow;
    }
  });
  $effect(() => {
    if (!live) return;
    live.active = new Set(model.views.find((v) => v.id === view)?.relationships ?? []);
    live.renderer.refresh();
  });
  function select(id: string, focus = false): void {
    selected = id;
    live?.select(id);
    if (focus) live?.focus(id);
  }
  onMount(() => {
    try {
      live = new LiveGraph(host, effects, graph, select, (value) => (zoom = value));
    } catch (reason) {
      error = String(reason);
    }
  });
  onDestroy(() => live?.dispose());
</script>

<div class="c4-viewer graph-preview" bind:this={surface} data-graph-preview>
  <GraphToolbar
    {model}
    {selected}
    bind:view
    bind:motion
    bind:flow
    onselect={(id) => select(id, true)}
    onfullscreen={() => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void surface.requestFullscreen();
    }}
  />
  <div class="content">
    <div class="graph-canvas" data-node-count={graph.order} data-edge-count={graph.size}>
      <div class="sigma-host" bind:this={host}></div>
      <canvas class="graph-effects" bind:this={effects} aria-hidden="true"></canvas>
      {#if error}<div class="graph-error"><Banner kind="error" text={error} /></div>{/if}
      <C4CanvasTools
        {zoom}
        min={1 / 3}
        max={1 / 0.12}
        onzoom={(factor) => live?.zoom(factor)}
        onfit={() => live?.fit()}
      />
    </div>
    {#if selected}<C4Details
        {model}
        {selected}
        onselect={(id) => select(id)}
        ondrill={() => {}}
      />{/if}
  </div>
  <footer class="graph-footer">
    <span>{t('graph.count', { nodes: graph.order, edges: graph.size })}</span><span
      >{t('graph.source')}</span
    >
  </footer>
</div>
