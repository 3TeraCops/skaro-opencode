<script lang="ts">
  import type { C4Graph, C4Node } from './graph';
  import { graphBounds } from './viewport';
  import { t } from '@skaro/ui';
  import { kindKey } from './i18n';
  import { routePath } from './route-path';
  let { graph, title }: { graph: C4Graph; title: string } = $props();
  const bounds = $derived(graphBounds(graph));
  function position(node: C4Node): { x: number; y: number } {
    const parent = node.parentId
      ? position(graph.nodes.find((n) => n.id === node.parentId)!)
      : { x: 0, y: 0 };
    return { x: parent.x + node.position.x, y: parent.y + node.position.y };
  }
  const nodes = $derived(
    [...graph.nodes].sort((a, b) => Number(b.data.boundary) - Number(a.data.boundary)),
  );
</script>

<svg
  class="c4-preview-svg"
  viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
  role="img"
  aria-label={title}
>
  {#each nodes as node (node.id)}
    {@const p = position(node)}
    <g transform={`translate(${p.x},${p.y})`}>
      <rect
        width={node.width}
        height={node.height}
        rx={node.data.boundary ? 10 : 8}
        fill={node.data.boundary ? 'transparent' : 'var(--sk-surface)'}
        stroke="var(--sk-line-strong)"
        stroke-width="1"
        stroke-dasharray={node.data.boundary ||
        node.data.element.state === 'planned' ||
        node.data.plannedChange
          ? '7 5'
          : undefined}
      />
      <text x="16" y="26" font-size="10" fill="var(--sk-text-muted)"
        >{t(kindKey(node.data.element.kind))}</text
      >
      {#each node.data.nameLines as line, i (i)}<text
          x="16"
          y={50 + i * 19}
          font-size="14"
          font-weight="700"
          fill="var(--sk-text-bright)">{line}</text
        >{/each}
      {#if !node.data.boundary}
        {@const start = 53 + node.data.nameLines.length * 19}
        {#each node.data.technologyLines as line, i (i)}<text
            x="16"
            y={start + i * 15}
            font-size="11"
            fill="var(--sk-link)">{line}</text
          >{/each}
        {#each node.data.descriptionLines as line, i (i)}<text
            x="16"
            y={start + node.data.technologyLines.length * 15 + 7 + i * 17}
            font-size="12"
            fill="var(--sk-text-secondary)">{line}</text
          >{/each}
      {/if}
    </g>
  {/each}
  {#each graph.edges as edge (edge.id)}
    <path
      d={routePath(edge.data?.points)}
      fill="none"
      stroke="var(--sk-text-muted)"
      stroke-width="1.5"
      stroke-dasharray={edge.data?.lifeline || edge.data?.planned ? '5 6' : undefined}
    />
    {#if !edge.data?.lifeline && edge.data?.points.length}
      {@const end = edge.data.points.at(-1)!}
      {@const before = edge.data.points.at(-2)!}
      <path
        d="M-9 -4L0 0L-9 4"
        transform={`translate(${end.x},${end.y}) rotate(${(Math.atan2(end.y - before.y, end.x - before.x) * 180) / Math.PI})`}
        fill="none"
        stroke="var(--sk-text-muted)"
        stroke-width="1.5"
      />
    {/if}
    {#if edge.data?.labelPosition}
      {@const label = edge.data.labelPosition}
      {@const top = label.y - (edge.data.labelHeight ?? 44) / 2}
      <rect
        x={label.x - 110}
        y={top}
        width="220"
        height={edge.data.labelHeight ?? 44}
        rx="6"
        fill="var(--sk-bg)"
      />
      {#each edge.data.textLines ?? [edge.data.text] as line, i (i)}
        <text
          x={label.x}
          y={top + 16 + i * 15}
          text-anchor="middle"
          font-size="11"
          fill="var(--sk-text)">{line}</text
        >
      {/each}
      {#each edge.data.technologyLines ?? [edge.data.technology] as line, i (i)}
        <text
          x={label.x}
          y={top + 16 + (edge.data.textLines?.length ?? 1) * 15 + i * 13}
          text-anchor="middle"
          font-size="10"
          font-family="var(--sk-mono)"
          fill="var(--sk-text-muted)">{line}</text
        >
      {/each}
    {/if}
  {/each}
</svg>

<style>
  .c4-preview-svg {
    display: block;
    width: 100%;
    height: var(--c4-preview-height, 340px);
    font-family: var(--sk-font);
    background: var(--sk-bg);
  }
</style>
