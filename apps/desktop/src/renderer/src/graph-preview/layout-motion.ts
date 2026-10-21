import type { PreviewGraph } from './projection';

type Position = { x: number; y: number };

/** Movement converges to the dependency layout and then stops; it never adds random drift. */
export class LayoutMotion {
  private targets = new Map<string, Position>();
  moving = false;

  private readonly graph: PreviewGraph;
  constructor(graph: PreviewGraph) {
    this.graph = graph;
  }

  target(positions: { id: string; x: number; y: number }[]): void {
    this.targets = new Map(positions.map(({ id, x, y }) => [id, { x, y }]));
    this.moving = true;
  }

  positions(): Record<string, Position> {
    return Object.fromEntries(this.targets);
  }

  step(delta: number, immediate = false): boolean {
    if (!this.moving) return false;
    let remaining = false;
    const amount = immediate ? 1 : 1 - Math.exp(-delta / 250);
    this.graph.updateEachNodeAttributes((id, node) => {
      const target = this.targets.get(id);
      if (!target) return node;
      const distance = Math.hypot(target.x - node.x, target.y - node.y);
      if (!immediate && distance > 0.0001) remaining = true;
      return {
        ...node,
        x: distance <= 0.0001 ? target.x : node.x + (target.x - node.x) * amount,
        y: distance <= 0.0001 ? target.y : node.y + (target.y - node.y) * amount,
      };
    });
    this.moving = remaining;
    return true;
  }
}
