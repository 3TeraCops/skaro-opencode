import { t, tn } from '@skaro/ui';
import type { TaskAssignment, TaskSummary } from '../../../shared/ipc';
import { type BulkAction, type Filters } from './model';
import { TaskRangeState } from './range.svelte';
import { TaskSelection } from './task-selection.svelte';
import type { TasksProps } from './tasks-props';
import type { TaskRange } from '../../../shared/task-catalog';

export function createTasksController(p: TasksProps) {
  let view = $state<'board' | 'list'>('board');
  let filters = $state<Filters>({ query: '', milestones: [], statuses: [], agents: [] });
  const selection = new TaskSelection(p.projectId, p.data);
  const list = new TaskRangeState(p.data, () => ({ ...filters, kind: 'list' }));
  /** "Выбрать несколько": cards show checkboxes and a click selects instead of opening. */
  let selecting = $state(false);
  let dialog = $state<Exclude<BulkAction, 'run'> | undefined>();
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void window.skaro
      .invoke('app.getSetting', `tasks.${p.projectId}.view`)
      .then((v) => (view = v === 'list' ? 'list' : 'board'));
  });

  const picked = $derived(selection.picked);
  const facets = $derived(p.data.catalog?.facets);
  const subtitle = $derived(
    [
      tn('board.count', facets?.total ?? 0),
      tn('board.running', facets?.working ?? 0),
      tn('board.waiting', facets?.attention ?? 0),
    ].join(' · '),
  );

  function setView(next: 'board' | 'list'): void {
    view = next;
    void window.skaro.invoke('app.setSetting', `tasks.${p.projectId}.view`, next);
  }

  function select(id: string, on: boolean, task?: TaskSummary): void {
    selection.select(id, on, task);
  }
  function selectColumn(source: TaskRange, on: boolean): void {
    void selection.column(source, on);
  }

  /** Leaving the mode drops the selection: without checkboxes there is nothing to show it. */
  function toggleSelecting(): void {
    selecting = !selecting;
    if (!selecting) selection.clear();
  }

  /** "Запустить" starts at once, each task with its own agent and model; the rest ask first. */
  function action(kind: BulkAction): void {
    if (kind === 'run') void run();
    else dialog = kind;
  }

  async function act(run: () => Promise<unknown>): Promise<void> {
    dialog = undefined;
    await run().catch(() => undefined);
  }

  const ids = () => $state.snapshot(selection.ids);

  function bulk(milestone?: string): Promise<void> {
    const kind = dialog;
    return act(async () => {
      if (kind === 'delete') await window.skaro.invoke('tasks.delete', p.projectId, ids());
      if (kind === 'archive') await window.skaro.invoke('tasks.archive', p.projectId, ids(), true);
      if (kind === 'unblock') await window.skaro.invoke('tasks.unblock', p.projectId, ids());
      if (kind === 'move' && milestone)
        await window.skaro.invoke('tasks.move', p.projectId, ids(), milestone);
      if (kind === 'delete' || kind === 'archive') selection.clear();
    });
  }

  function run(): Promise<void> {
    return act(async () => {
      await p.data.run(ids(), t('task.start.message'));
      selection.clear();
    });
  }

  function assign(assignment: TaskAssignment): Promise<void> {
    return act(() => window.skaro.invoke('tasks.assign', p.projectId, ids(), assignment));
  }

  return {
    p,
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get filters() {
      return filters;
    },
    set filters(value: typeof filters) {
      filters = value;
    },
    get selected() {
      return selection.ids;
    },
    set selected(value: string[]) {
      if (value.length) selection.ids = value;
      else selection.clear();
    },
    get selecting() {
      return selecting;
    },
    get dialog() {
      return dialog;
    },
    set dialog(value: typeof dialog) {
      dialog = value;
    },
    get now() {
      return now;
    },
    list,
    selection,
    get facets() {
      return facets;
    },
    get picked() {
      return picked;
    },
    get subtitle() {
      return subtitle;
    },
    setView,
    select,
    selectColumn,
    toggleSelecting,
    action,
    bulk,
    assign,
  };
}

export type TasksController = ReturnType<typeof createTasksController>;
