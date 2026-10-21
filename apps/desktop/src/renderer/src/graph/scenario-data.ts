import type { ProjectGraph } from './data.svelte';
import { mergePage } from './page-data';

export async function activateScenario(model: ProjectGraph, viewId: string): Promise<void> {
  if (viewId === 'overview') {
    model.playback.close();
    await model.refresh();
    model.persist();
    return;
  }
  const scenario = model.scenarios.find((item) => item.viewId === viewId);
  if (!scenario) return;
  model.playback.load(scenario);
  model.highlighted = [];
  await model.refresh();
  let page = model.page;
  const snapshot = model.snapshot?.id;
  for (const id of scenario.participants) {
    const planned =
      scenario.state === 'planned' &&
      model.model?.elements.some(
        (node) => node.id === id && (node.planned || node.state === 'planned'),
      );
    const part = await model.query({
      operation: 'neighbors',
      id: `c4:${planned ? 'planned:' : ''}${id}`,
      depth: 1,
      direction: 'both',
    });
    if (model.snapshot?.id !== snapshot || model.playback.scenario !== scenario) return;
    page = mergePage(page, part);
  }
  model.page = page;
  model.persist();
}
