<script lang="ts">
  import { Button, Select, t } from '@skaro/ui';
  import type { GraphNode, SourceRef } from '@skaro/core/graph-view';
  import type { ProjectGraph } from './data.svelte';
  import GraphAnalysis from './GraphAnalysis.svelte';
  let {
    node,
    model,
    onsource,
    onc4,
    ondoc,
    ontask,
  }: {
    node: GraphNode;
    model: ProjectGraph;
    onsource: (ref: SourceRef) => void;
    onc4: (view: string, element?: string) => void;
    ondoc: (path: string) => void;
    ontask: (id: string) => void;
  } = $props();
  const c4Id = $derived(String(node.attributes.c4Id ?? ''));
  const views = $derived(
    model.model?.views
      .filter(
        (view) =>
          view.state === (node.state ?? 'current') &&
          (view.elements.includes(c4Id) ||
            view.scope === c4Id ||
            (Array.isArray(node.attributes.c4Views) && node.attributes.c4Views.includes(view.id))),
      )
      .map((view) => ({ value: view.id, label: view.title })) ?? [],
  );
</script>

{#if node.attributes.projection || node.kind === 'file' || node.kind === 'document'}<Button
    size="sm"
    onclick={() => {
      void model.expand(node.id);
    }}>{t('graph.expand')}</Button
  >{/if}
{#if !node.attributes.projection}<Button
    variant="ghost"
    size="sm"
    onclick={() => {
      void model.neighbors(node.id);
    }}>{t('graph.neighbors')}</Button
  >{/if}
{#if views.length}<Select
    options={[{ value: '', label: t('graph.openC4') }, ...views]}
    label={t('graph.openC4')}
    width="100%"
    menuWidth="100%"
    bind:value={
      () => '',
      (view) => {
        if (view) onc4(view, c4Id);
      }
    }
  />{/if}
{#if node.kind === 'document' && node.sources[0]?.path.startsWith('.skaro/')}<Button
    variant="ghost"
    size="sm"
    onclick={() => ondoc(node.sources[0]!.path)}>{t('graph.openDocument')}</Button
  >{/if}
{#if node.kind === 'task' || node.kind === 'milestone'}<Button
    variant="ghost"
    size="sm"
    onclick={() => ontask(String(node.attributes.artifactId))}>{t('graph.openTask')}</Button
  >{/if}
<h4>{t('graph.sources')}</h4>
{#if node.attributes.c4Stale}<p>{t('graph.staleBinding')}</p>{/if}
{#each node.sources as source, index (index)}<Button
    variant="ghost"
    size="sm"
    onclick={() => onsource(source)}
    ><code>{source.path}{source.line ? `:${source.line}` : ''}</code></Button
  >{/each}
{#if !node.attributes.projection}<GraphAnalysis {model} id={node.id} name={node.name} />{/if}
