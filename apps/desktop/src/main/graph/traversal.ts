import type { GraphQuery, GraphEdge } from '@skaro/core/graph-view';
import type { GraphStore } from './store';
import { nodeMatches } from './query-validation';

const dependencies = new Set([
  'imports',
  'calls',
  'inherits',
  'implements',
  'requests',
  'emits',
  'consumes',
  'reads',
  'writes',
  'model-relation',
  'depends-on',
]);
export function traverse(
  store: GraphStore,
  query: GraphQuery,
): { ids: string[]; edges: string[]; path: string[]; incomplete: boolean; reason?: string } {
  if (!query.id || !store.nodes(query.snapshotId, [query.id]).length)
    throw new Error('Unknown graph traversal origin');
  const visited = new Set([query.id]),
    queue: { id: string; depth: number }[] = [{ id: query.id, depth: 0 }];
  const previous = new Map<string, { node: string; edge: string }>(),
    selected = new Set<string>();
  const direction = query.direction ?? (query.operation === 'impact' ? 'in' : 'out');
  const limit = query.depth ?? (query.operation === 'neighbors' ? 1 : 12),
    start = performance.now();
  let incomplete = false,
    reason: string | undefined,
    found = query.id === query.target;
  const read = store.db.prepare(
    `SELECT data FROM edges WHERE snapshot=? AND ${direction === 'out' ? 'source=?' : direction === 'in' ? 'target=?' : '(source=? OR target=?)'} ORDER BY id LIMIT 20001`,
  );
  for (let index = 0; index < queue.length && !found; index++) {
    if (visited.size >= 20_000 || performance.now() - start > 250) {
      incomplete = true;
      reason = 'traversal-budget';
      break;
    }
    const current = queue[index]!;
    const rows = (
      direction === 'both'
        ? read.all(query.snapshotId, current.id, current.id)
        : read.all(query.snapshotId, current.id)
    ) as { data: string }[];
    if (rows.length > 20_000) {
      incomplete = true;
      reason = 'adjacency-budget';
    }
    for (const row of rows) {
      const edge = JSON.parse(row.data) as GraphEdge;
      if (
        query.filter?.edges?.length
          ? !query.filter.edges.includes(edge.kind)
          : query.operation === 'impact' && !dependencies.has(edge.kind)
      )
        continue;
      if (
        !(
          query.filter?.resolutions?.length ? query.filter.resolutions : ['explicit', 'resolved']
        ).includes(edge.resolution)
      )
        continue;
      if (
        (query.filter?.state ?? 'current') !== 'all' &&
        edge.state &&
        edge.state !== (query.filter?.state ?? 'current')
      )
        continue;
      const target = edge.source === current.id ? edge.target : edge.source;
      const candidate = store.nodes(query.snapshotId, [target])[0];
      if (!candidate || !nodeMatches(candidate, query.filter)) continue;
      if (visited.has(target)) {
        if (query.operation !== 'path') selected.add(edge.id);
        continue;
      }
      if (current.depth >= limit) {
        incomplete = true;
        reason ??= 'depth-limit';
        continue;
      }
      visited.add(target);
      previous.set(target, { node: current.id, edge: edge.id });
      selected.add(edge.id);
      queue.push({ id: target, depth: current.depth + 1 });
      if (query.operation === 'path' && target === query.target) {
        found = true;
        break;
      }
      if (visited.size >= 20_000) break;
    }
  }
  if (query.operation === 'path') {
    const path: string[] = [],
      ids: string[] = [];
    if (found) {
      let id = query.target!;
      ids.push(id);
      while (id !== query.id) {
        const step = previous.get(id)!;
        path.unshift(step.edge);
        id = step.node;
        ids.unshift(id);
      }
      return { ids, edges: path, path, incomplete: false };
    }
    if (!incomplete && store.snapshot(query.snapshotId)?.coverage.unresolved) {
      incomplete = true;
      reason = 'unresolved-coverage';
    }
    return { ids: [query.id], edges: [], path: [], incomplete, reason: reason ?? 'no-path' };
  }
  return {
    ids: [...visited],
    edges: [...selected],
    path: [],
    incomplete,
    ...(reason ? { reason } : {}),
  };
}
