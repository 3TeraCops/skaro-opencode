<script lang="ts">
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Preview from './C4Preview.svelte';
  let { model, onopen }: { model: C4Model; onopen: (viewId: string) => void } = $props();
</script>

<div class="c4-gallery" data-c4-gallery>
  <div class="previews">
    {#each model.views as view (view.id)}
      <C4Preview {model} {view} onopen={() => onopen(view.id)} />
    {/each}
  </div>
</div>

<style>
  .c4-gallery {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    container-type: inline-size;
    padding: 18px;
    background: var(--sk-bg);
    --c4-preview-height: 180px;
  }
  .previews {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 18px;
  }
  @container (min-width: 960px) {
    .previews {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
