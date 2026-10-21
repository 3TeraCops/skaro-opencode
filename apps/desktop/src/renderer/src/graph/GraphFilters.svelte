<script lang="ts">
  import { Select, Popover, Button, Icon, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  import type { GraphFilter, NodeKind, EdgeKind, Origin, Resolution } from '@skaro/core/graph-view';
  import { kinds, edgeKinds, origins, resolutions, options } from './filter-options';
  let { model }: { model: ProjectGraph } = $props();
  const languages = $derived(
    ['all', ...Object.keys(model.snapshot?.coverage.languages ?? {}).sort()].map((value) => ({
      value,
      label: value === 'all' ? t('graph.allLanguages') : value,
    })),
  );
  function change(value: Partial<GraphFilter>): void {
    model.filter = { ...model.filter, ...value };
    void model.refresh();
  }
  const subsystems = $derived(
    [
      ...new Set([
        ...(model.page?.nodes.flatMap((node) =>
          node.sources.map((source) => source.path.split('/').slice(0, 2).join('/')),
        ) ?? []),
        ...(model.filter.subsystem ? [model.filter.subsystem] : []),
      ]),
    ]
      .filter((path) => path.includes('/'))
      .sort(),
  );
</script>

<nav class="c4-viewer-nav graph-filters" aria-label={t('graph.filters')}>
  <Select
    label={t('graph.state')}
    width={160}
    options={[
      { value: 'current', label: t('c4.current') },
      { value: 'planned', label: t('c4.planned') },
      { value: 'all', label: t('graph.allStates') },
    ]}
    bind:value={() => model.filter.state ?? 'current', (state) => change({ state })}
  />
  <Select
    label={t('graph.layers')}
    width={150}
    options={options(kinds, 'graph.kind', 'graph.allLayers')}
    bind:value={
      () => model.filter.kinds?.[0] ?? 'all',
      (kind) => change({ kinds: kind === 'all' ? [] : [kind as NodeKind] })
    }
  />
  <Select
    label={t('graph.edgeTypes')}
    width={170}
    options={options(edgeKinds, 'graph.edge', 'graph.allEdges')}
    bind:value={
      () => model.filter.edges?.[0] ?? 'all',
      (kind) => change({ edges: kind === 'all' ? [] : [kind as EdgeKind] })
    }
  />
  <Popover width={330}>
    {#snippet trigger({ toggle })}<Button variant="ghost" size="sm" onclick={toggle}
        ><Icon name="filters" size={15} />{t('graph.moreFilters')}</Button
      >{/snippet}
    <div class="graph-filter-menu">
      <Select
        label={t('graph.origin')}
        width="100%"
        menuWidth="100%"
        options={options(origins, 'graph.origin', 'graph.allOrigins')}
        bind:value={
          () => model.filter.origins?.[0] ?? 'all',
          (origin) => change({ origins: origin === 'all' ? [] : [origin as Origin] })
        }
      />
      <Select
        label={t('graph.resolution')}
        width="100%"
        menuWidth="100%"
        options={options(resolutions, 'graph.resolution', 'graph.allResolutions')}
        bind:value={
          () => model.filter.resolutions?.[0] ?? 'all',
          (resolution) =>
            change({ resolutions: resolution === 'all' ? [] : [resolution as Resolution] })
        }
      />
      <Select
        label={t('graph.language')}
        width="100%"
        menuWidth="100%"
        options={languages}
        bind:value={
          () => model.filter.language ?? 'all',
          (language) => change({ language: language === 'all' ? '' : language })
        }
      />
      <Select
        label={t('graph.subsystem')}
        width="100%"
        menuWidth="100%"
        options={[
          { value: '', label: t('graph.allSubsystems') },
          ...subsystems.map((value) => ({ value, label: value })),
        ]}
        bind:value={() => model.filter.subsystem ?? '', (subsystem) => change({ subsystem })}
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
</nav>

<style>
  .graph-filters {
    flex-wrap: wrap;
  }
  .graph-filter-menu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
</style>
