import type { ProjectGraph } from './data.svelte';

export async function openGraphTarget(
  model: ProjectGraph,
  target: { elementId: string; viewId?: string },
): Promise<void> {
  const view = model.model?.views.find((view) => view.id === target.viewId);
  if (view?.kind === 'dynamic') await model.scenario(view.id);
  else if (view?.state === 'planned') {
    model.filter = { ...model.filter, state: 'all' };
    await model.refresh();
  }
  const id = target.elementId.replace(/^c4:(?:planned:)?/, '');
  if (!id) return;
  const element = model.model?.elements.find((item) => item.id === id);
  const relation = model.model?.relationships.find((item) => item.id === id);
  const value = element ?? relation;
  const key = `c4:${view?.state === 'planned' && (value?.state === 'planned' || value?.planned) ? 'planned:' : ''}${id}`;
  if (relation) await model.select(key);
  else await model.focusNode(key);
}
