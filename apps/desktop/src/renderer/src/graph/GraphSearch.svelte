<script lang="ts">
  import { Popover, TextField, SelectOption, Banner, t } from '@skaro/ui';
  import type { GraphNode } from '@skaro/core/graph-view';
  let {
    search,
    onselect,
  }: { search: (text: string) => Promise<GraphNode[]>; onselect: (id: string) => void } = $props();
  let query = $state(''),
    results = $state.raw<GraphNode[]>([]),
    busy = $state(false),
    failure = $state('');
  let open = $derived(query.trim().length > 0);
  let serial = 0;
  $effect(() => {
    const text = query.trim(),
      revision = ++serial;
    if (!text) {
      results = [];
      failure = '';
      busy = false;
      return;
    }
    results = [];
    failure = '';
    busy = true;
    const timer = setTimeout(() => {
      busy = true;
      void search(text)
        .then(
          (nodes) => {
            if (revision === serial) {
              results = nodes;
              failure = '';
            }
          },
          (error) => {
            if (revision === serial) failure = String(error);
          },
        )
        .finally(() => {
          if (revision === serial) busy = false;
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      serial++;
    };
  });
</script>

<div class="graph-search">
  <Popover bind:open align="right" width={380}>
    {#snippet trigger()}<TextField
        search
        bind:value={query}
        placeholder={t('c4.search')}
        aria-label={t('c4.search')}
        onkeydown={(event) => {
          if (event.key === 'Enter' && results[0]) {
            onselect(results[0].id);
            query = '';
          }
        }}
      />{/snippet}
    {#snippet children({ close })}<div role="listbox" aria-label={t('c4.search')}>
        {#each results as node (node.id)}<SelectOption
            option={{
              value: node.id,
              label: node.state === 'planned' ? `${t('c4.planned')} · ${node.name}` : node.name,
              description: node.qualifiedName ?? node.sources[0]?.path ?? node.id,
            }}
            selected={false}
            onpick={() => {
              onselect(node.id);
              query = '';
              close();
            }}
          />{/each}
      </div>
      {#if !results.length}<Banner
          kind={failure ? 'error' : 'info'}
          text={failure || t(busy ? 'graph.loading' : 'graph.noResults')}
        />{/if}{/snippet}
  </Popover>
</div>

<style>
  .graph-search {
    width: 240px;
    min-width: 160px;
    flex: none;
  }
</style>
