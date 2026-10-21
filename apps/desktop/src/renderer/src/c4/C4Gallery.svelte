<script lang="ts">
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Preview from './C4Preview.svelte';
  import C4List from './C4List.svelte';
  import { ViewSwitch, t } from '@skaro/ui';
  import './i18n';
  let { model, onopen }: { model: C4Model; onopen: (viewId: string) => void } = $props();
  let view = $state(localStorage.getItem('skaro.c4.gallery') === 'list' ? 'list' : 'grid');
</script>

<div class="c4-gallery" data-c4-gallery>
  <div class="toolbar">
    <ViewSwitch
      value={view}
      options={[
        { id: 'list', label: t('c4.view.list'), icon: 'list' },
        { id: 'grid', label: t('c4.view.grid'), icon: 'board' },
      ]}
      onchange={(next) => {
        view = next;
        localStorage.setItem('skaro.c4.gallery', next);
      }}
    />
  </div>
  {#if view === 'list'}
    <C4List views={model.views} {onopen} />
  {:else}
    <div class="previews">
      {#each model.views as view (view.id)}
        <C4Preview {model} {view} onopen={() => onopen(view.id)} />
      {/each}
    </div>
  {/if}
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
  .toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 18px;
  }
  @container (min-width: 960px) {
    .previews {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
