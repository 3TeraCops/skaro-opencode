import type { Viewport } from '@xyflow/svelte';
import type { C4Graph } from './graph';
import type { C4Model } from '@skaro/core/c4-view';

export function selectedBounds(graph: C4Graph, id: string) {
  const position = (nodeId: string): { x: number; y: number } => {
    const node = graph.nodes.find((n) => n.id === nodeId)!;
    const parent = node.parentId ? position(node.parentId) : { x: 0, y: 0 };
    return { x: parent.x + node.position.x, y: parent.y + node.position.y };
  };
  const chosen = graph.nodes.filter((n) => n.id === id || n.data.element.id === id);
  if (!chosen.length) return undefined;
  const boxes = chosen.map((n) => ({
    ...position(n.id),
    width: n.width ?? 248,
    height: n.height ?? 160,
  }));
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/** Scope saved navigation to this exact model, including projects with the same title. */
export function viewportKey(model: C4Model, viewId: string): string {
  const text = JSON.stringify(model);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1:${model.title}:${model.revision}:${hash >>> 0}:${viewId}`;
}

export function graphBounds(graph: C4Graph) {
  const position = (id: string): { x: number; y: number } => {
    const node = graph.nodes.find((n) => n.id === id)!;
    const parent = node.parentId ? position(node.parentId) : { x: 0, y: 0 };
    return { x: parent.x + node.position.x, y: parent.y + node.position.y };
  };
  const points = graph.nodes
    .flatMap((n) => {
      const p = position(n.id);
      return [p, { x: p.x + (n.width ?? 280), y: p.y + (n.height ?? 180) }];
    })
    .concat(
      graph.edges.flatMap((e) => {
        const label = e.data?.labelPosition,
          height = e.data?.labelHeight ?? 44;
        return [
          ...(e.data?.points ?? []),
          ...(label
            ? [
                { x: label.x - 110, y: label.y - height / 2 },
                { x: label.x + 110, y: label.y + height / 2 },
              ]
            : []),
        ];
      }),
    );
  const x = Math.min(0, ...points.map((p) => p.x)) - 35;
  const y = Math.min(0, ...points.map((p) => p.y)) - 35;
  return {
    x,
    y,
    width: Math.max(1, ...points.map((p) => p.x)) - x + 35,
    height: Math.max(1, ...points.map((p) => p.y)) - y + 35,
  };
}
export function loadViewport(key: string): Viewport | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(`skaro.c4.${key}`) ?? 'null') as Viewport | null;
    return value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      value.zoom >= 0.02 &&
      value.zoom <= 4
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
export function saveViewport(key: string, value: Viewport): void {
  try {
    localStorage.setItem(`skaro.c4.${key}`, JSON.stringify(value));
  } catch {
    /* Storage quota must not break diagram navigation. */
  }
}
