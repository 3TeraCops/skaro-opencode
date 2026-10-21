<script lang="ts">
  import { Select, FilterMenu, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  import type { GraphFilter, NodeKind, EdgeKind } from '@skaro/core/graph-view';
  import { kinds, edgeKinds, options } from './filter-options';
  import GraphMoreFilters from './GraphMoreFilters.svelte';
  let { model }: { model: ProjectGraph } = $props();
  function change(value: Partial<GraphFilter>): void {
    model.filter = { ...model.filter, ...value };
    void model.refresh();
  }
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
  <FilterMenu
    label={t('graph.layers')}
    options={options(kinds, 'graph.kind')}
    bind:selected={
      () => model.filter.kinds ?? [], (values) => change({ kinds: values as NodeKind[] })
    }
  />
  <FilterMenu
    label={t('graph.edgeTypes')}
    options={options(edgeKinds, 'graph.edge')}
    bind:selected={
      () => model.filter.edges ?? [], (values) => change({ edges: values as EdgeKind[] })
    }
  />
  <GraphMoreFilters {model} {change} />
</nav>

<style>
  .graph-filters {
    flex-wrap: wrap;
  }
</style>
