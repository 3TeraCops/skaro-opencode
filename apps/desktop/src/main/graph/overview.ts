import type { GraphNode, GraphEdge, GraphQuery } from '@skaro/core/graph-view';
import type { GraphStore } from './store';
import { nodeMatches } from './query-validation';
import { hash } from './facts';

export function overview(
  store: GraphStore,
  query: GraphQuery,
): { nodes: GraphNode[]; edges: GraphEdge[]; aggregated: number } {
  const rows = store.db
    .prepare('SELECT data FROM nodes WHERE snapshot=? ORDER BY id')
    .all(query.snapshotId) as { data: string }[];
  const nodes = new Map<string, GraphNode>(),
    representatives = new Map<string, string>();
  const expanded = new Set(query.expanded ?? []);
  if (query.operation === 'expand' && query.id) expanded.add(query.id);
  let aggregated = 0;
  for (const row of rows) {
    const node = JSON.parse(row.data) as GraphNode;
    if (!nodeMatches(node, query.filter)) continue;
    const path = node.sources[0]?.path;
    if (node.kind === 'architecture' || node.kind === 'instance' || !path) {
      nodes.set(node.id, node);
      representatives.set(node.id, node.id);
      continue;
    }
    const parts = path.split('/');
    let count = Math.min(2, parts.length - 1);
    while (count < parts.length - 1 && expanded.has(`group:${parts.slice(0, count).join('/')}`))
      count++;
    const group = `group:${parts.slice(0, count).join('/')}`;
    let representative = count > 0 && !expanded.has(group) ? group : `file:${path}`;
    if (
      expanded.has(`file:${path}`) ||
      node.kind === 'file' ||
      node.kind === 'document' ||
      node.kind === 'task' ||
      node.kind === 'milestone'
    ) {
      if (representative === `file:${path}`) representative = node.id;
    }
    representatives.set(node.id, representative);
    if (representative === node.id) {
      nodes.set(node.id, node);
      continue;
    }
    aggregated++;
    const existing = nodes.get(representative);
    if (existing) existing.attributes.members = Number(existing.attributes.members ?? 0) + 1;
    else
      nodes.set(representative, {
        id: representative,
        kind: representative.startsWith('group:') ? 'package' : 'file',
        name: representative.startsWith('group:') ? parts.slice(0, count).join('/') : parts.at(-1)!,
        qualifiedName: representative.startsWith('group:') ? parts.slice(0, count).join('/') : path,
        origin: 'analyzer-inferred',
        sources: node.sources,
        attributes: {
          projection: true,
          members: 1,
          path: representative.slice(representative.indexOf(':') + 1),
          language: String(node.attributes.language ?? ''),
        },
      });
  }
  const edges = new Map<string, GraphEdge>();
  const edgeRows = store.db
    .prepare('SELECT data FROM edges WHERE snapshot=? ORDER BY id')
    .all(query.snapshotId) as { data: string }[];
  for (const row of edgeRows) {
    const edge = JSON.parse(row.data) as GraphEdge;
    if (
      (query.filter?.state ?? 'current') !== 'all' &&
      edge.state &&
      edge.state !== (query.filter?.state ?? 'current')
    )
      continue;
    if (query.filter?.edges?.length && !query.filter.edges.includes(edge.kind)) continue;
    if (query.filter?.resolutions?.length && !query.filter.resolutions.includes(edge.resolution))
      continue;
    const source = representatives.get(edge.source),
      target = representatives.get(edge.target);
    if (!source || !target) continue;
    if (source === edge.source && target === edge.target) {
      edges.set(edge.id, edge);
      continue;
    }
    if (source === target) continue;
    const id = `aggregate:${hash(`${source}\0${target}\0${edge.kind}\0${edge.resolution}`).slice(0, 24)}`;
    const previous = edges.get(id);
    if (previous) {
      previous.members!.count++;
      if (previous.members!.ids.length < 100) previous.members!.ids.push(edge.id);
      else previous.members!.truncated = true;
      previous.label = `${edge.kind} · ${previous.members!.count}`;
    } else
      edges.set(id, {
        ...edge,
        id,
        source,
        target,
        evidence: edge.evidence.slice(0, 3),
        label: `${edge.kind} · 1`,
        members: { count: 1, ids: [edge.id], truncated: false },
      });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], aggregated };
}
