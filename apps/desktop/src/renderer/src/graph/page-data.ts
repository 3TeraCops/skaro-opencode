import type { GraphPage } from '@skaro/core/graph-view';

export function mergePage(before: GraphPage | undefined, next: GraphPage): GraphPage {
  if (!before || before.snapshotId !== next.snapshotId) return next;
  const nodes = new Map(before.nodes.map((node) => [node.id, node]));
  const edges = new Map(before.edges.map((edge) => [edge.id, edge]));
  next.nodes.forEach((node) => nodes.set(node.id, node));
  next.edges.forEach((edge) => edges.set(edge.id, edge));
  const clipped = nodes.size > 5000 || edges.size > 20_000;
  const visible = [...nodes.values()].slice(0, 5000),
    ids = new Set(visible.map((node) => node.id));
  const metadata = next.queryHash === before.queryHash ? next : before;
  return {
    ...metadata,
    nodes: visible,
    edges: [...edges.values()]
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .slice(0, 20_000),
    incomplete: clipped || before.incomplete || next.incomplete,
    ...(clipped ? { reason: 'materialization-budget' } : {}),
  };
}
