<script lang="ts">
  import { ArrowLeft, Maximize2, Minimize2, X } from '@lucide/svelte';
  import { IconButton, Select, t } from '@skaro/ui';
  import C4Search from './C4Search.svelte';
  import type { C4ViewerState } from './viewer-state.svelte';
  let { state }: { state: C4ViewerState } = $props();
  const options = $derived(
    state.model.views.map((view) => ({
      value: view.id,
      label: view.title,
      description: `${t(`c4.${view.kind}`)} · ${t(`c4.${view.state}`)}`,
    })),
  );
</script>

<header class="c4-viewer-header">
  <IconButton tip={t('c4.back')} onclick={state.back}
    ><ArrowLeft size={16} strokeWidth={1.8} /></IconButton
  >
  <div class="c4-viewer-heading">
    <strong>{state.model.title}</strong><span
      >C4 · {t('c4.revision', { n: state.model.revision })}</span
    >
  </div>
  <IconButton
    tip={t(state.fullscreen ? 'c4.exitFullscreen' : 'c4.fullscreen')}
    onclick={() => void state.toggleFullscreen()}
  >
    {#if state.fullscreen}<Minimize2 size={15} strokeWidth={1.9} />{:else}<Maximize2
        size={15}
        strokeWidth={1.9}
      />{/if}
  </IconButton>
  <IconButton tip={t('c4.close')} onclick={() => void state.close()}
    ><X size={14} strokeWidth={2.2} /></IconButton
  >
</header>
<nav class="c4-viewer-nav">
  <div class="c4-viewer-select">
    <Select
      {options}
      width="100%"
      menuWidth="100%"
      label={t('c4.view')}
      bind:value={() => state.view.id, (id) => state.go(id)}
    />
  </div>
  <C4Search {state} />
</nav>
