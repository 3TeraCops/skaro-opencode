<script lang="ts">
  import { Popover, SelectOption, TextField, t } from '@skaro/ui';
  import type { C4Element } from '@skaro/core/c4-view';
  let { elements, onselect }: { elements: C4Element[]; onselect: (id: string) => void } = $props();
  let query = $state('');
  const results = $derived(
    query.trim()
      ? elements
          .filter((e) =>
            `${e.name} ${e.id} ${e.code.join(' ')}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          )
          .slice(0, 12)
      : [],
  );
  let open = $derived(!!query.trim() && results.length > 0);
</script>

<div class="c4-viewer-search">
  <Popover bind:open width={340} align="right" offset={38} maxHeight={300}>
    {#snippet trigger()}
      <TextField
        search
        aria-label={t('c4.search')}
        placeholder={t('c4.search')}
        bind:value={query}
        onkeydown={(event) => {
          if (event.key === 'Enter' && results[0]) {
            onselect(results[0].id);
            query = '';
          }
        }}
      />
    {/snippet}
    {#snippet children({ close })}
      {#each results as element (element.id)}
        <SelectOption
          option={{
            value: element.id,
            label: element.name,
            description: element.technology ?? element.description,
          }}
          selected={false}
          onpick={() => {
            onselect(element.id);
            query = '';
            close();
          }}
        />
      {/each}
    {/snippet}
  </Popover>
</div>
