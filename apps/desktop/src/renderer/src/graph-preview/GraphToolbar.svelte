<script lang="ts">
  import { IconButton, Select, Toggle, t } from '@skaro/ui';
  import { Pause, Play, X, Maximize2 } from '@lucide/svelte';
  import type { C4Model } from '@skaro/core/c4-view';
  import GraphSearch from './GraphSearch.svelte';
  import { groups, colors } from './projection';
  let {
    model,
    selected,
    view = $bindable('overview'),
    motion = $bindable(true),
    flow = $bindable(true),
    onselect,
    onfullscreen,
  }: {
    model: C4Model;
    selected: string;
    view: string;
    motion: boolean;
    flow: boolean;
    onselect: (id: string) => void;
    onfullscreen: () => void;
  } = $props();
  const options = $derived([
    { value: 'overview', label: t('graph.overview') },
    ...model.views
      .filter((v) => v.kind === 'dynamic')
      .map((v) => ({ value: v.id, label: v.title })),
  ]);
</script>

<header class="c4-viewer-header">
  <div class="c4-viewer-heading">
    <strong>{t('graph.title')}</strong><span
      >{model.title} · C4 · {t('c4.revision', { n: model.revision })}</span
    >
  </div>
  <IconButton
    tip={t(motion ? 'graph.pause' : 'graph.resume')}
    active={!motion}
    onclick={() => {
      motion = !motion;
      flow = motion;
    }}
  >
    {#if motion}<Pause size={16} />{:else}<Play size={16} />{/if}
  </IconButton>
  <IconButton tip={t('c4.fullscreen')} onclick={onfullscreen}><Maximize2 size={15} /></IconButton>
  {#if selected}<IconButton tip={t('graph.clear')} onclick={() => onselect('')}
      ><X size={15} /></IconButton
    >{/if}
</header>
<nav class="c4-viewer-nav">
  <div class="c4-viewer-select">
    <Select {options} bind:value={view} width="100%" menuWidth={480} label={t('c4.view')} />
  </div>
  <GraphSearch elements={model.elements} {onselect} />
</nav>
<div class="graph-legend">
  {#each groups as group (group)}<span
      ><i style:background={colors[group]}></i>{t(`graph.${group}`)}</span
    >{/each}
  <div class="graph-toggles">
    <div><Toggle bind:checked={motion} label={t('graph.motion')} /></div>
    <div><Toggle bind:checked={flow} label={t('graph.flow')} /></div>
  </div>
</div>
