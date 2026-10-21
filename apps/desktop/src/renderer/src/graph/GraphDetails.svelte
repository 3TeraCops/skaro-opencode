<script lang="ts">
  import { Button, Select, t } from '@skaro/ui';
  import { c4AtState } from '@skaro/core/c4-view';
  import type { SourceRef } from '@skaro/core/graph-view';
  import C4Details from '../c4/C4Details.svelte';
  import '../c4/details.css';
  import type { ProjectGraph } from './data.svelte';
  import GraphNodeActions from './GraphNodeActions.svelte';
  import GraphEdgeEvidence from './GraphEdgeEvidence.svelte';
  let {
    model,
    onsource,
    onc4,
    ondoc,
    ontask,
  }: {
    model: ProjectGraph;
    onsource: (ref: SourceRef) => void;
    onc4: (view: string, element?: string) => void;
    ondoc: (path: string) => void;
    ontask: (id: string) => void;
  } = $props();
  const node = $derived(
    model.details?.nodes[0] ?? model.page?.nodes.find((item) => item.id === model.selected),
  );
  const edge = $derived(
    model.details?.edges[0] ?? model.page?.edges.find((item) => item.id === model.selected),
  );
  const c4Id = $derived(
    node?.attributes.c4Id
      ? String(node.attributes.c4Id)
      : edge?.id.startsWith('c4:')
        ? edge.id.replace(/^c4:(?:planned:)?/, '')
        : '',
  );
  const planned = $derived(node?.state === 'planned' || edge?.state === 'planned');
  const projected = $derived.by(() => {
    if (!model.model) return null;
    const projection = c4AtState(model.model, planned ? 'planned' : 'current');
    return planned
      ? projection
      : {
          ...projection,
          elements: projection.elements.filter((item) => item.state === 'current'),
          relationships: projection.relationships.filter((item) => item.state === 'current'),
        };
  });
  const original = $derived(
    projected &&
      c4Id &&
      [...projected.elements, ...projected.relationships].some((item) => item.id === c4Id),
  );
  async function openCode(path: string): Promise<void> {
    try {
      const result = await model.query({ operation: 'details', id: `file:${path}` });
      if (result.nodes[0]?.sources[0]) onsource(result.nodes[0].sources[0]);
    } catch (error) {
      try {
        const descendants = await model.search(path);
        if (
          descendants.some((item) =>
            item.sources.some((source) => source.path.startsWith(path.replace(/\/$/, '') + '/')),
          )
        )
          await model.expand(`group:${path.replace(/\/$/, '')}`);
        else model.error = String(error);
      } catch (reason) {
        model.error = String(reason);
      }
    }
  }
  function selectC4(id: string): void {
    const item =
      model.model?.elements.find((item) => item.id === id) ??
      model.model?.relationships.find((item) => item.id === id);
    const key = `c4:${planned && (item?.planned || item?.state === 'planned') ? 'planned:' : ''}${id}`;
    if (model.model?.relationships.some((item) => item.id === id)) void model.select(key);
    else void model.focusNode(key);
  }
</script>

{#if original && projected}
  <C4Details
    model={projected}
    selected={c4Id}
    {planned}
    onselect={selectC4}
    ondrill={() => {}}
    onsource={(path) => {
      void openCode(path);
    }}
  >
    {#if node}<GraphNodeActions {node} {model} {onsource} {onc4} {ondoc} {ontask} />{/if}
    {#if edge}<GraphEdgeEvidence {edge} {onsource} />{/if}
  </C4Details>
{:else if node || edge}
  <aside class="c4-details" aria-label={t('graph.details')}>
    <span class="kind">{t(node ? `graph.kind.${node.kind}` : `graph.edge.${edge!.kind}`)}</span>
    <h3>{node?.name ?? edge?.label ?? edge?.kind}</h3>
    <code>{node?.qualifiedName ?? node?.id ?? edge?.id}</code>
    <span class="state"
      >{t(`graph.origin.${node?.origin ?? edge?.origin}`)}{#if edge}
        · {t(`graph.resolution.${edge.resolution}`)}{/if}</span
    >
    {#if node?.attributes.description}<p>{String(node.attributes.description)}</p>{/if}
    {#if node?.attributes.members}<p>
        {t('graph.groupMembers', { n: Number(node.attributes.members) })}
      </p>{/if}
    {#if node}<GraphNodeActions {node} {model} {onsource} {onc4} {ondoc} {ontask} />{/if}
    {#if edge}
      {#each [edge.source, edge.target] as id, index (index)}<Button
          variant="ghost"
          size="sm"
          onclick={() => {
            void model.focusNode(id);
          }}>{model.page?.nodes.find((node) => node.id === id)?.name ?? id}</Button
        >{/each}
      <GraphEdgeEvidence {edge} {onsource} />
      {#if edge.members}<p>{t('graph.originalEdges', { n: edge.members.count })}</p>
        <Select
          label={t('graph.originalEdges', { n: edge.members.count })}
          width="100%"
          options={[
            { value: '', label: t('graph.chooseOriginal') },
            ...edge.members.ids.map((id) => ({ value: id, label: id })),
          ]}
          bind:value={
            () => '',
            (id) => {
              if (id) void model.select(id);
            }
          }
        />{/if}
    {/if}
    {#if model.details?.unresolved?.length}<h4>{t('graph.unresolved')}</h4>
      {#each model.details.unresolved as reference, index (index)}<p>
          {reference.name} · {reference.reason}
        </p>{/each}{/if}
  </aside>
{/if}
