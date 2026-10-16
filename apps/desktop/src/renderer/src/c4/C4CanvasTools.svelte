<script lang="ts">
  import { Minus, Plus, Scan } from '@lucide/svelte';
  import { IconButton, t } from '@skaro/ui';
  let {
    zoom,
    onzoom,
    onfit,
  }: { zoom: number; onzoom: (factor: number) => void; onfit: () => void } = $props();
</script>

<div class="c4-canvas-tools">
  <IconButton tip={t('c4.zoomOut')} onclick={() => onzoom(1 / 1.25)}
    ><Minus size={15} strokeWidth={1.8} /></IconButton
  >
  <span>{Math.round(zoom * 100)}%</span>
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
  span {
    min-width: 42px;
    text-align: center;
    font: var(--sk-fs-3) var(--sk-mono);
    color: var(--sk-text-muted);
  }
</style>
