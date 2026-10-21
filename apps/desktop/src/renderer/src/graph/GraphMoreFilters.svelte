<script lang="ts">
  import { untrack } from 'svelte';
  import { FilterMenu, Popover, Button, Icon, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  import type { GraphFilter, Origin, Resolution } from '@skaro/core/graph-view';
  import { origins, resolutions, options } from './filter-options';
  let { model, change }: { model: ProjectGraph; change: (filter: Partial<GraphFilter>) => void } =
    $props();
  let subsystems = $state<string[]>([]);
  $effect(() => {
    const paths =
      model.page?.nodes.flatMap((node) => node.sources.map((source) => source.path)) ?? [];
    subsystems = [
      ...new Set([
        ...untrack(() => subsystems),
        ...paths
          .filter((path) => !path.startsWith('.skaro/'))
          .map((path) => path.split('/').slice(0, -1).slice(0, 2).join('/')),
      ]),
    ]
      .filter(Boolean)
      .sort();
  });
  const languages = $derived(
    Object.keys(model.snapshot?.coverage.languages ?? {})
      .sort()
      .map((value) => ({ value, label: value })),
  );
</script>

<Popover width={330}>
  {#snippet trigger({ toggle })}<Button variant="ghost" size="sm" onclick={toggle}
      ><Icon name="filters" size={15} />{t('graph.moreFilters')}</Button
    >{/snippet}
  <div class="graph-filter-menu">
    <FilterMenu
      label={t('graph.origin')}
      options={options(origins, 'graph.origin')}
      bind:selected={
        () => model.filter.origins ?? [], (values) => change({ origins: values as Origin[] })
      }
    />
    <FilterMenu
      label={t('graph.resolution')}
      options={options(resolutions, 'graph.resolution')}
      bind:selected={
        () => model.filter.resolutions ?? [],
        (values) => change({ resolutions: values as Resolution[] })
      }
    />
    <FilterMenu
      label={t('graph.language')}
      options={languages}
      bind:selected={
        () => model.filter.languages ?? (model.filter.language ? [model.filter.language] : []),
        (values) => change({ languages: values, language: '' })
      }
    />
    <FilterMenu
      label={t('graph.subsystem')}
      width={300}
      options={subsystems.map((value) => ({ value, label: value }))}
      bind:selected={
        () => model.filter.subsystems ?? (model.filter.subsystem ? [model.filter.subsystem] : []),
        (values) => change({ subsystems: values, subsystem: '' })
      }
    />
    <Button
      variant="ghost"
      size="sm"
      onclick={() => {
        model.filter = { state: 'current' };
        void model.refresh();
      }}>{t('graph.resetFilters')}</Button
    >
  </div>
</Popover>

<style>
  .graph-filter-menu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
</style>
