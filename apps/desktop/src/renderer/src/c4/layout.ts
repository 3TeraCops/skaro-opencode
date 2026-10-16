import type { C4Model, C4View } from '@skaro/core/c4-view';
import { buildC4Graph, type C4Graph } from './graph';
import { layoutC4Graph } from './layout-engine';

const cache = new Map<string, Promise<C4Graph>>();
let active = 0;
const waiting: (() => void)[] = [];
async function inWorkerSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await operation();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export function layoutC4(model: C4Model, view: C4View): Promise<C4Graph> {
  const key = JSON.stringify([model, view.id]);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = inWorkerSlot(() => compute(model, view)).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return pending;
}

async function compute(model: C4Model, view: C4View): Promise<C4Graph> {
  await document.fonts.ready;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('C4: text measurement is unavailable');
  context.font = '14px "Nunito Sans Variable"';
  const graph = buildC4Graph(model, view, (text) => context.measureText(text).width);
  return layoutC4Graph(graph, view.kind === 'dynamic');
}
