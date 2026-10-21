import type { Facts } from '../facts';

/** Internal Skaro artifacts feed C4 validation, but are not project graph objects. */
export function hideInternalArtifacts(facts: Facts): void {
  for (const [id, node] of facts.nodes) {
    if (
      node.origin !== 'accepted-c4' &&
      node.sources.length &&
      node.sources.every((source) => source.path.startsWith('.skaro/'))
    )
      facts.nodes.delete(id);
  }
  for (const [id, edge] of facts.edges)
    if (!facts.nodes.has(edge.source) || !facts.nodes.has(edge.target)) facts.edges.delete(id);
  for (let index = facts.unresolved.length - 1; index >= 0; index--)
    if (!facts.nodes.has(facts.unresolved[index]!.source)) facts.unresolved.splice(index, 1);
}
