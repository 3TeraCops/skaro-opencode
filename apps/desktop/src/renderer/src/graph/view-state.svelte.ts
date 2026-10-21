import type { GraphViewState } from '@skaro/core/graph-view';
import type { ProjectGraph } from './data.svelte';

const internalPath = (path: string) => path === '.skaro' || path.startsWith('.skaro/');
const visibleSelection = (id: string) => !/^(?:file|group):\.skaro(?:\/|$)/.test(id);

export function restoreGraphView(
  model: ProjectGraph,
  saved: GraphViewState | null,
  checkoutId?: string,
): void {
  model.saved = saved
    ? { ...saved, selected: visibleSelection(saved.selected ?? '') ? (saved.selected ?? '') : '' }
    : undefined;
  if (!saved || saved.checkoutId !== checkoutId) return;
  const { subsystem, subsystems, ...filter } = saved.filter;
  model.filter = {
    ...filter,
    ...(subsystem && !internalPath(subsystem) ? { subsystem } : {}),
    ...(subsystems ? { subsystems: subsystems.filter((path) => !internalPath(path)) } : {}),
  };
  model.expanded = saved.expanded.filter(visibleSelection);
  model.history = saved.history.filter(visibleSelection);
  model.historyIndex = model.history.length - 1;
  model.camera = saved.camera;
  model.positions = saved.positions ?? {};
}

export async function restoreGraphSelection(model: ProjectGraph): Promise<void> {
  const previous = model.selected || model.saved?.selected;
  if (previous) await model.select(previous, false);
  const restore = model.saved?.scenario;
  if (restore && restore.c4Hash === model.snapshot?.c4Hash) {
    const scenario = model.scenarios.find((item) => item.viewId === restore.viewId);
    if (scenario) {
      await model.scenario(scenario.viewId);
      model.playback.load(scenario, restore);
    }
  }
  model.saved = undefined;
}

/** Presentation settings are stored in Skaro, independently of source facts. */
export function saveGraphView(model: ProjectGraph): void {
  if (!model.snapshot) return;
  const scenario = model.playback.scenario;
  const view: GraphViewState = {
    version: 1,
    checkoutId: model.snapshot.checkoutId,
    selected: model.selected,
    filter: $state.snapshot(model.filter),
    expanded: $state.snapshot(model.expanded),
    history: $state.snapshot(model.history),
    ...(model.camera ? { camera: model.camera } : {}),
    positions: model.positions,
    ...(scenario
      ? {
          scenario: {
            viewId: scenario.viewId,
            c4Hash: scenario.c4Hash,
            step: model.playback.index,
            speed: model.playback.speed,
          },
        }
      : {}),
  };
  void window.skaro.invoke('graph.saveView', model.projectId, view).catch(() => undefined);
}
