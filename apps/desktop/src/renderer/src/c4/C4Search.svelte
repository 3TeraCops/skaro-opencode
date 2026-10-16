<script lang="ts">
  import { Popover, SelectOption, TextField, t } from '@skaro/ui';
  import { kindKey } from './i18n';
  import type { C4ViewerState } from './viewer-state.svelte';
  let { state: viewer }: { state: C4ViewerState } = $props();
  let open = $derived(!!viewer.query.trim() && viewer.results.length > 0);
</script>

<div class="c4-viewer-search">
  <Popover bind:open width={340} align="right" offset={38} maxHeight={300}>
    {#snippet trigger()}
      <TextField
        search
        aria-label={t('c4.search')}
        placeholder={t('c4.search')}
        bind:value={viewer.query}
        onfocus={() => (open = !!viewer.query.trim())}
        onkeydown={(event) => {
          if (event.key === 'Enter' && viewer.results[0]) {
            event.preventDefault();
            viewer.searchSelect(viewer.results[0].id);
            open = false;
          }
        }}
      />
    {/snippet}
    {#snippet children({ close })}
      {#each viewer.results as element (element.id)}
        <SelectOption
          option={{
            value: element.id,
            label: element.name,
            description: element.technology ?? element.description,
            tag: t(kindKey(element.kind)),
          }}
          selected={viewer.selected === element.id}
          onpick={() => {
            viewer.searchSelect(element.id);
            close();
          }}
        />
      {/each}
    {/snippet}
  </Popover>
</div>
