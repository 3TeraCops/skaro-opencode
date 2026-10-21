import type Sigma from 'sigma';
import type { NodeData, EdgeData } from './projection';

export function fitGraph(renderer: Sigma<NodeData, EdgeData>, container: HTMLElement): void {
  const camera = renderer.getCamera();
  camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  renderer.refresh();
  const points = renderer.getGraph().mapNodes((_id, node) => renderer.graphToViewport(node));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = container.clientWidth;
  const height = container.clientHeight;
  const ratio = Math.max(
    (Math.max(...xs) - Math.min(...xs)) / Math.max(1, width - 160),
    (Math.max(...ys) - Math.min(...ys)) / Math.max(1, height - 110),
    0.2,
  );
  camera.setState({ ratio });
  renderer.refresh();
  container.dataset.fitted = String(
    renderer.getGraph().everyNode((_id, node) => {
      const point = renderer.graphToViewport(node);
      return point.x > 25 && point.x < width - 25 && point.y > 25 && point.y < height - 25;
    }),
  );
}
