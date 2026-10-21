import type { C4Model, C4State } from '@skaro/core/c4-view';
export function c4NodeId(model: C4Model, id: string, state: C4State): string {
  const element = model.elements.find((item) => item.id === id);
  return `c4:${state === 'planned' && (element?.planned || element?.state === 'planned') ? 'planned:' : ''}${id}`;
}
