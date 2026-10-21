import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

self.onmessage = (
  event: MessageEvent<{
    nodes: { id: string; x: number; y: number; group: string }[];
    edges: { id: string; source: string; target: string }[];
  }>,
) => {
  const graph = new MultiDirectedGraph();
  event.data.nodes.forEach((node) => graph.addNode(node.id, { x: node.x, y: node.y }));
  event.data.edges.forEach((edge) =>
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target),
  );
  forceAtlas2.assign(graph, {
    iterations: 200,
    settings: {
      barnesHutOptimize: true,
      gravity: 0.6,
      scalingRatio: 6,
      linLogMode: true,
      strongGravityMode: false,
      slowDown: 5,
    },
  });
  const families = ['interface', 'dialogs', 'ai', 'platform', 'external', 'infrastructure'];
  const output: { id: string; x: number; y: number }[] = [];
  for (const [sector, family] of families.entries()) {
    const members = event.data.nodes.filter((node) => node.group === family);
    const xs = members.map((node) => graph.getNodeAttribute(node.id, 'x') as number);
    const ys = members.map((node) => graph.getNodeAttribute(node.id, 'y') as number);
    const x0 = Math.min(...xs),
      y0 = Math.min(...ys);
    const xSpan = Math.max(1, Math.max(...xs) - x0),
      ySpan = Math.max(1, Math.max(...ys) - y0);
    const angle = (sector * Math.PI) / 3 + Math.PI / 6;
    const centerX = Math.cos(angle) * 3.1,
      centerY = Math.sin(angle) * 2.6;
    const ranked = [...members].sort((a, b) => graph.degree(b.id) - graph.degree(a.id));
    const local = ranked.map((node, index) => {
      const attributes = graph.getNodeAttributes(node.id);
      const radius = Math.sqrt(index / Math.max(1, members.length - 1));
      return {
        id: node.id,
        x: ((attributes.x - x0) / xSpan - 0.5) * 0.9 + Math.cos(index * 2.399963) * radius * 1.4,
        y: ((attributes.y - y0) / ySpan - 0.5) * 0.8 + Math.sin(index * 2.399963) * radius * 1.3,
      };
    });
    for (let iteration = 0; iteration < 40; iteration++) {
      for (let i = 0; i < local.length; i++) {
        for (let j = i + 1; j < local.length; j++) {
          const a = local[i]!,
            b = local[j]!;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.001;
          if (distance >= 0.36) continue;
          const shift = ((0.36 - distance) * 0.3) / distance;
          a.x -= dx * shift;
          a.y -= dy * shift;
          b.x += dx * shift;
          b.y += dy * shift;
        }
      }
    }
    for (const node of local) {
      output.push({
        id: node.id,
        x: centerX + node.x,
        y: centerY + node.y,
      });
    }
  }
  self.postMessage(output);
};
