import { c4AtState, type C4Model } from '@skaro/core/c4-view';

export function createC4Viewer(getModel: () => C4Model, initialView: string, onclose: () => void) {
  let surface: HTMLDivElement;
  let viewId = $state(initialView),
    selected = $state(''),
    history = $state<{ viewId: string; selected: string }[]>([]);
  let focusRequest = $state(0);
  let fullscreen = $state(false),
    error = $state(''),
    query = $state('');
  const model = $derived(getModel());
  const view = $derived(model.views.find((v) => v.id === viewId) ?? model.views[0]!);
  const displayed = $derived(c4AtState(model, view.state));
  const results = $derived(
    query.trim()
      ? model.elements
          .filter((e) =>
            `${e.name} ${e.id} ${e.description}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          )
          .slice(0, 12)
      : [],
  );
  function go(id: string): void {
    if (id === viewId) return;
    history = [...history, { viewId, selected }];
    viewId = id;
    selected = '';
    query = '';
  }
  function drillTarget(id: string) {
    return model.views.find(
      (v) =>
        v.scope === id &&
        v.id !== viewId &&
        v.state === view.state &&
        ['container', 'component', 'code'].includes(v.kind),
    );
  }
  function drill(id: string): void {
    const next = drillTarget(id);
    if (next) go(next.id);
  }
  async function close(): Promise<void> {
    if (document.fullscreenElement === surface) await document.exitFullscreen();
    onclose();
  }
  return {
    get model() {
      return model;
    },
    get view() {
      return view;
    },
    get displayed() {
      return displayed;
    },
    get selected() {
      return selected;
    },
    set selected(id: string) {
      selected = id;
    },
    get query() {
      return query;
    },
    set query(text: string) {
      query = text;
    },
    get error() {
      return error;
    },
    set error(text: string) {
      error = text;
    },
    get fullscreen() {
      return fullscreen;
    },
    get focusRequest() {
      return focusRequest;
    },
    get results() {
      return results;
    },
    attach(element: HTMLDivElement) {
      surface = element;
    },
    fullscreenChanged() {
      fullscreen = document.fullscreenElement === surface;
    },
    go,
    drill,
    canDrill: (id: string) => !!drillTarget(id),
    back() {
      if (!history.length) {
        void close();
        return;
      }
      const previous = history.at(-1)!;
      viewId = previous.viewId;
      history = history.slice(0, -1);
      selected = previous.selected;
      query = '';
    },
    searchSelect(id: string) {
      const target = view.elements.includes(id)
        ? view
        : model.views.find((v) => v.elements.includes(id));
      if (target) {
        if (target.id === viewId) history = [...history, { viewId, selected }];
        go(target.id);
        selected = id;
        query = '';
        focusRequest++;
      }
    },
    async toggleFullscreen() {
      try {
        if (document.fullscreenElement === surface) await document.exitFullscreen();
        else await surface.requestFullscreen();
      } catch (reason) {
        error = String(reason);
      }
    },
    close,
  };
}
export type C4ViewerState = ReturnType<typeof createC4Viewer>;
