<script lang="ts">
  import { BaseEdge, EdgeLabel, type EdgeProps } from '@xyflow/svelte';
  import type { C4Edge } from './graph';
  import { routePath } from './route-path';
  let { id, data, selected }: EdgeProps<C4Edge> = $props();
  const path = $derived(routePath(data?.points));
  const label = $derived(data?.labelPosition);
  const marker = $derived(`c4-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
</script>

<defs
  ><marker
    id={marker}
    viewBox="0 0 10 10"
    refX="9"
    refY="5"
    markerWidth="7"
    markerHeight="7"
    orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="var(--sk-text-secondary)" /></marker
  ></defs
>
<BaseEdge
  {id}
  {path}
  markerEnd={data?.lifeline ? undefined : `url(#${marker})`}
  style={`stroke:${selected ? 'var(--sk-link)' : 'var(--sk-text-muted)'};stroke-width:${selected ? 2.3 : 1.5};${data?.lifeline ? 'stroke-dasharray:5 6;opacity:.45;' : data?.planned ? 'stroke-dasharray:5 6;' : ''}`}
/>
{#if label && data?.text}
  <EdgeLabel x={label.x} y={label.y} transparent selectEdgeOnClick>
    <div class="c4-edge-label" class:selected>
      {#each data.textLines ?? [data.text] as line, i (i)}<span>{line}</span>{/each}
      {#each data.technologyLines ?? [data.technology] as line, i (i)}<small>{line}</small>{/each}
    </div>
  </EdgeLabel>
{/if}
