<script lang="ts">
  import { Minus, Plus, Scan } from '@lucide/svelte';
  import { IconButton, t } from '@skaro/ui';
  import ZoomPercent from './ZoomPercent.svelte';
  let {
    zoom,
    onzoom,
    onfit,
    min = 0.02,
    max = 4,
  }: {
    zoom: number;
    onzoom: (factor: number) => void;
    onfit: () => void;
    min?: number;
    max?: number;
  } = $props();
</script>

<div class="c4-canvas-tools">
  <IconButton tip={t('c4.zoomOut')} onclick={() => onzoom(1 / 1.25)}
    ><Minus size={15} strokeWidth={1.8} /></IconButton
  >
  <ZoomPercent {zoom} {onzoom} {min} {max} />
  <IconButton tip={t('c4.zoomIn')} onclick={() => onzoom(1.25)}
    ><Plus size={15} strokeWidth={1.8} /></IconButton
  >
  <IconButton tip={t('c4.fit')} onclick={onfit}><Scan size={15} strokeWidth={1.8} /></IconButton>
</div>

<style>
  .c4-canvas-tools {
    position: absolute;
    left: 16px;
    bottom: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--sk-radius);
    background: var(--sk-modal);
    box-shadow:
      0 0 0 1px var(--sk-white-a4),
      0 8px 24px var(--sk-black-a35);
  }
</style>
