import { MultiDirectedGraph } from 'graphology';
import { c4AtState, type C4Element, type C4Model } from '@skaro/core/c4-view';

export const groups = [
  'interface',
  'dialogs',
  'ai',
  'platform',
  'external',
  'infrastructure',
] as const;
export type Group = (typeof groups)[number];
export const colors: Record<Group, string> = {
  interface: '#7d9ce8',
  dialogs: '#7fbb9c',
  ai: '#b2a0da',
  platform: '#cc9a78',
  external: '#cc8ca2',
  infrastructure: '#7ea9c8',
};
export type NodeData = {
  x: number;
  y: number;
  label: string;
  color: string;
  size: number;
  group: Group;
  phase: number;
  forceLabel: boolean;
  planned?: boolean;
};
export type EdgeData = {
  color: string;
  size: number;
  type: string;
  ordinal: number;
  structural: boolean;
  curvature?: number;
  loopIndex?: number;
};
export type PreviewGraph = MultiDirectedGraph<NodeData, EdgeData>;

function groupOf(element: C4Element, elements: Map<string, C4Element>): Group {
  const ancestors: string[] = [element.id];
  let parent = element.parent;
  while (parent && !ancestors.includes(parent)) {
    ancestors.push(parent);
    parent = elements.get(parent)?.parent;
  }
  const family = ancestors.join(' ');
  if (/component-(ai|privacy|knowledge|skills|tools|assistance|quality)/.test(family)) return 'ai';
  if (
    /component-(conversations|collaboration|availability|transports|webchat|calls|notifications|routing)/.test(
      family,
    )
  )
    return 'dialogs';
  if (/container-workbench|container-widget|ui-|widget-/.test(family)) return 'interface';
  if (element.external || element.kind === 'person') return 'external';
  if (
    element.kind === 'deployment-node' ||
    /container-(postgres|redis|turn|gateway|media|frontend|secret|update|cli)/.test(family)
  )
    return 'infrastructure';
  return 'platform';
}

export function projectGraph(source: C4Model): { model: C4Model; graph: PreviewGraph } {
  const current = c4AtState(source, 'current');
  const model = {
    ...current,
    elements: current.elements.filter((e) => e.state === 'current'),
    relationships: current.relationships.filter((r) => r.state === 'current'),
    views: current.views.filter((v) => v.state === 'current'),
  };
  const elements = new Map(model.elements.map((element) => [element.id, element]));
  const graph: PreviewGraph = new MultiDirectedGraph();
  const buckets = new Map<Group, C4Element[]>(groups.map((group) => [group, []]));
  for (const element of model.elements) buckets.get(groupOf(element, elements))!.push(element);
  for (const [group, members] of buckets) {
    const sector = (groups.indexOf(group) * Math.PI) / 3;
    members.forEach((element, index) => {
      const angle = index * 2.399963,
        radius = 1.25 * Math.sqrt((index + 1) / members.length);
      graph.addNode(element.id, {
        x: Math.cos(sector) * 2.3 + Math.cos(angle) * radius,
        y: Math.sin(sector) * 2.3 + Math.sin(angle) * radius,
        label: element.name,
        color: colors[group],
        group,
        size: 4,
        phase: index * 1.69 + sector,
        forceLabel: false,
      });
    });
  }
  model.relationships.forEach((relation, ordinal) => {
    if (graph.hasNode(relation.source) && graph.hasNode(relation.target))
      graph.addDirectedEdgeWithKey(relation.id, relation.source, relation.target, {
        color: '#515763',
        size: 0.65,
        type: 'line',
        ordinal,
        structural: false,
      });
  });
  for (const element of model.elements) {
    if (
      element.parent &&
      graph.hasNode(element.parent) &&
      (graph.degree(element.id) === 0 || element.kind === 'deployment-node')
    )
      graph.addDirectedEdgeWithKey(`contains:${element.id}`, element.parent, element.id, {
        color: '#3c414a',
        size: 0.45,
        type: 'line',
        ordinal: -1,
        structural: true,
      });
  }
  for (const view of model.views.filter((v) => v.kind === 'deployment')) {
    for (const instance of view.instances) {
      const id = `deploys:${instance.node}:${instance.element}`;
      if (!graph.hasEdge(id) && graph.hasNode(instance.node) && graph.hasNode(instance.element))
        graph.addDirectedEdgeWithKey(id, instance.node, instance.element, {
          color: '#3c414a',
          size: 0.45,
          type: 'line',
          ordinal: -1,
          structural: true,
        });
    }
  }
  graph.forEachNode((id) => {
    const degree = graph.degree(id);
    graph.mergeNodeAttributes(id, {
      size: Math.min(15, 2.5 + Math.sqrt(degree) * 1.4),
      forceLabel: degree >= 30,
    });
  });
  for (const group of groups) {
    const leader = graph
      .filterNodes((_id, node) => node.group === group)
      .sort((a, b) => graph.degree(b) - graph.degree(a))[0];
    if (leader) graph.setNodeAttribute(leader, 'forceLabel', true);
  }
  return { model, graph };
}
