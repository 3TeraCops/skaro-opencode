import { MultiDirectedGraph } from 'graphology';
import type { GraphPage, GraphNode } from '@skaro/core/graph-view';
import { colors, groups, type Group, type PreviewGraph } from '../graph-preview/projection';

function family(node: GraphNode): Group {
  const text = `${node.id} ${node.sources[0]?.path ?? ''}`;
  if (node.attributes.external) return 'external';
  if (
    node.kind === 'service' ||
    node.kind === 'instance' ||
    node.attributes.c4Kind === 'deployment-node' ||
    /(?:postgres|redis|gateway|media|deploy|turn-server)/i.test(text)
  )
    return 'infrastructure';
  if (
    /(?:^|[/:_.-])(?:ai|knowledge|privacy|skills|tools|assistance|quality)(?:[/:_.-]|$)/i.test(text)
  )
    return 'ai';
  if (
    /(?:conversations|collaboration|availability|webchat|notifications|routing|transports|calls)/i.test(
      text,
    )
  )
    return 'dialogs';
  if (/(?:internal-ui|web-chat|workbench|widget|frontend|renderer|ui-)/i.test(text))
    return 'interface';
  return 'platform';
}
export function renderGraph(page: GraphPage, plannedLabel: string): PreviewGraph {
  const graph: PreviewGraph = new MultiDirectedGraph();
  const buckets = new Map<Group, GraphNode[]>(groups.map((group) => [group, []]));
  for (const node of page.nodes) buckets.get(family(node))!.push(node);
  for (const [group, members] of buckets) {
    const sector = (groups.indexOf(group) * Math.PI) / 3;
    members.forEach((node, index) => {
      const angle = index * 2.399963,
        radius = 1.25 * Math.sqrt((index + 1) / members.length);
      graph.addNode(node.id, {
        x: Math.cos(sector) * 2.3 + Math.cos(angle) * radius,
        y: Math.sin(sector) * 2.3 + Math.sin(angle) * radius,
        label: node.state === 'planned' ? `${plannedLabel} · ${node.name}` : node.name,
        color: colors[group],
        size: 4,
        group,
        phase: index * 1.69 + sector,
        forceLabel: false,
        planned: node.state === 'planned',
      });
    });
  }
  const pairs = new Map<string, string[]>();
  for (const [index, edge] of page.edges.entries()) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const structural = [
      'contains',
      'references',
      'documents',
      'covers',
      'governed-by',
      'implements-requirement',
    ].includes(edge.kind);
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      color: structural ? '#3c414a' : '#515763',
      size: structural ? 0.45 : 0.65,
      type: edge.source === edge.target || structural ? 'line' : 'arrow',
      ordinal: index,
      structural,
      ...(edge.source === edge.target ? { hidden: true } : {}),
    });
    const pair = [edge.source, edge.target].sort().join('\0'),
      values = pairs.get(pair) ?? [];
    values.push(edge.id);
    pairs.set(pair, values);
  }
  for (const values of pairs.values())
    values.sort().forEach((id, index) => {
      const [source, target] = graph.extremities(id);
      if (source === target) graph.setEdgeAttribute(id, 'loopIndex', index);
      else if (values.length > 1) {
        const curvature =
          ((index - (values.length - 1) / 2) * 0.15 || 0.035) * (source < target ? 1 : -1);
        graph.mergeEdgeAttributes(id, { type: 'curved', curvature });
      }
    });
  graph.forEachNode((id) =>
    graph.mergeNodeAttributes(id, {
      size: Math.min(15, 2.5 + Math.sqrt(graph.degree(id)) * 1.4),
      forceLabel: graph.degree(id) >= 30,
    }),
  );
  for (const group of groups) {
    const leader = graph
      .filterNodes((_id, node) => node.group === group)
      .sort((a, b) => graph.degree(b) - graph.degree(a))[0];
    if (leader) graph.setNodeAttribute(leader, 'forceLabel', true);
  }
  return graph;
}
