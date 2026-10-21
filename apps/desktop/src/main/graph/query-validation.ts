import type { GraphQuery, GraphFilter, GraphScope } from '@skaro/core/graph-view';
import { hash } from './facts';
import type { GraphStore } from './store';

export function assertScope(store: GraphStore, scope: GraphScope) {
  if (
    !scope ||
    typeof scope.snapshotId !== 'string' ||
    typeof scope.checkoutId !== 'string' ||
    typeof scope.projectId !== 'string' ||
    typeof scope.requestId !== 'string' ||
    scope.requestId.length > 200
  )
    throw new Error('Invalid graph scope');
  const snapshot = store.snapshot(scope.snapshotId);
  if (
    !snapshot ||
    snapshot.projectId !== scope.projectId ||
    snapshot.checkoutId !== scope.checkoutId
  )
    throw new Error('graph-snapshot-expired');
  return snapshot;
}
export function validateQuery(query: GraphQuery): {
  queryHash: string;
  offset: number;
  limit: number;
} {
  if (
    !['overview', 'expand', 'search', 'details', 'neighbors', 'path', 'impact'].includes(
      query.operation,
    )
  )
    throw new Error('Invalid graph query');
  for (const key of ['id', 'target', 'text'] as const)
    if (query[key] !== undefined && (typeof query[key] !== 'string' || query[key]!.length > 1000))
      throw new Error('Invalid graph query argument');
  if (query.direction && !['out', 'in', 'both'].includes(query.direction))
    throw new Error('Invalid graph direction');
  if (
    query.depth !== undefined &&
    (!Number.isInteger(query.depth) || query.depth < 0 || query.depth > 64)
  )
    throw new Error('Invalid graph depth');
  if (
    query.expanded &&
    (!Array.isArray(query.expanded) ||
      query.expanded.length > 500 ||
      query.expanded.some((id) => typeof id !== 'string' || id.length > 1000))
  )
    throw new Error('Invalid graph expansions');
  const filter = query.filter ?? {};
  for (const key of ['kinds', 'edges', 'origins', 'resolutions'] as const)
    if (
      filter[key] &&
      (!Array.isArray(filter[key]) ||
        filter[key]!.length > 30 ||
        filter[key]!.some((value) => typeof value !== 'string' || value.length > 80))
    )
      throw new Error('Invalid graph filter');
  if (filter.state && !['current', 'planned', 'all'].includes(filter.state))
    throw new Error('Invalid architecture state');
  for (const key of ['language', 'subsystem'] as const)
    if (filter[key] !== undefined && (typeof filter[key] !== 'string' || filter[key]!.length > 300))
      throw new Error('Invalid graph scope filter');
  const limit = Math.min(
    query.operation === 'search' ? 100 : 500,
    Math.max(1, Math.floor(query.limit ?? 500)),
  );
  if (!Number.isFinite(limit)) throw new Error('Invalid graph page size');
  const { requestId: _request, cursor: _cursor, ...basis } = query;
  const queryHash = hash(JSON.stringify(basis));
  let offset = 0;
  if (query.cursor) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 1024)
      throw new Error('Invalid graph cursor');
    const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as {
      snapshot: string;
      query: string;
      offset: number;
    };
    if (
      cursor.snapshot !== query.snapshotId ||
      cursor.query !== queryHash ||
      !Number.isInteger(cursor.offset) ||
      cursor.offset < 0 ||
      cursor.offset > 1_000_000
    )
      throw new Error('graph-cursor-expired');
    offset = cursor.offset;
  }
  return { queryHash, offset, limit };
}
export function cursorFor(query: GraphQuery, queryHash: string, offset: number): string {
  return Buffer.from(
    JSON.stringify({ snapshot: query.snapshotId, query: queryHash, offset }),
  ).toString('base64url');
}
export function nodeMatches(
  node: {
    kind: string;
    origin: string;
    state?: string;
    attributes?: Record<string, unknown>;
    sources?: { path: string }[];
  },
  filter: GraphFilter = {},
): boolean {
  return (
    (!filter.kinds?.length || filter.kinds.includes(node.kind as never)) &&
    (!filter.origins?.length || filter.origins.includes(node.origin as never)) &&
    ((filter.state ?? 'current') === 'all' ||
      !node.state ||
      node.state === (filter.state ?? 'current')) &&
    (!filter.language || node.attributes?.language === filter.language) &&
    (!filter.subsystem ||
      node.sources?.some(
        (source) =>
          source.path === filter.subsystem || source.path.startsWith(filter.subsystem + '/'),
      ) === true)
  );
}
