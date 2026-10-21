import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

self.onmessage = (
  event: MessageEvent<{
    nodes: { id: string; x: number; y: number }[];
    edges: { id: string; source: string; target: string }[];
  }>,
) => {
  const graph = new MultiDirectedGraph();
  event.data.nodes.forEach((node) => graph.addNode(node.id, { x: node.x, y: node.y }));
  event.data.edges.forEach((edge) => {
    if (edge.source !== edge.target)
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
  });
  // Attraction follows actual dependencies. Repulsion separates unrelated objects.
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
  const positions = graph.mapNodes((id, node) => ({
    id,
    x: node.x as number,
    y: node.y as number,
  }));
  const xs = positions.map((node) => node.x),
    ys = positions.map((node) => node.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const scale = 7 / Math.max(1, right - left, bottom - top);
  self.postMessage(
    positions.map((node) => ({
      id: node.id,
      x: (node.x - (left + right) / 2) * scale,
      y: (node.y - (top + bottom) / 2) * scale,
    })),
  );
};
