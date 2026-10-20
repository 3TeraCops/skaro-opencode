// What a drop on the board does: the card's new place is kept, a move to another column runs
// the task action at once on screen and is rolled back if it fails or is cancelled.

import { t } from '@skaro/ui';
import { columnOf } from '../../../shared/task-presentation';
import type { TaskAssignment, TaskSummary } from '../../../shared/ipc';
import { moveOf, type ColumnKey } from './board-moves';
import { TaskRangeState } from './range.svelte';
import type { TaskFilters } from '../../../shared/task-catalog';
import type { ProjectTasks } from './data.svelte';

export function createBoardMoves(p: {
  projectId: () => string;
  data: ProjectTasks;
  filters: () => TaskFilters;
  onopen: (id: string) => void;
  run: (ids: string[], message: string, assignment?: TaskAssignment) => Promise<void>;
}) {
  let pendingDrop: Promise<unknown> = Promise.resolve();
  /** Cards shown in another column while their action runs. */
  let moved = $state<Partial<Record<string, ColumnKey>>>({});
  /** The task whose launch dialog is open after a drop on "В работе". */
  let starting = $state<{ task: TaskSummary; done: (ok: boolean) => void } | undefined>();

  const cols = (['todo', 'working', 'review', 'done'] as const).map((key) => ({
    key,
    color: 'var(--sk-text-13)',
    range: new TaskRangeState(p.data, () => ({ ...p.filters(), column: key, moved })),
  }));

  $effect(() => {
    void p.data.version;
    const snapshot = $state.snapshot(moved),
      ids = Object.keys(snapshot);
    if (!ids.length) return;
    let cancelled = false;
    void window.skaro.invoke('tasks.selected', p.projectId(), ids).then((records) => {
      if (cancelled) return;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Transient lookup rebuilt from the current read.
      const byId = new Map(records.map((task) => [task.id, task])),
        next = { ...snapshot };
      let changed = false;
      for (const id of ids) {
        const task = byId.get(id);
        if (!task || columnOf(task) === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      if (changed) moved = next;
    });
    return () => {
      cancelled = true;
    };
  });

  function back(id: string): void {
    const next = { ...moved };
    delete next[id];
    moved = next;
  }

  function place(to: ColumnKey, task: TaskSummary, index: number): void {
    const range = cols.find((col) => col.key === to)!.range;
    pendingDrop = (async () => {
      await range.ready();
      if (!range.source) return;
      await window.skaro.invoke('tasks.reorder', range.source, task.id, to, index);
      await p.data.reload();
    })();
  }

  /** Opens the launch dialog for one task; true when it was started. */
  function askStart(task: TaskSummary): Promise<boolean> {
    return new Promise((done) => (starting = { task, done }));
  }

  async function act(task: TaskSummary, to: ColumnKey, run: () => Promise<unknown>): Promise<void> {
    moved = { ...moved, [task.id]: to };
    try {
      if ((await run()) === false) back(task.id);
    } catch {
      back(task.id);
    }
  }

  function drop(task: TaskSummary, from: ColumnKey, to: ColumnKey, index: number): void {
    const move = moveOf(task, from, to);
    if (!move) return;
    place(to, task, index);
    const id = p.projectId();
    if (move === 'start') void act(task, to, () => askStart(task));
    if (move === 'cancel')
      void act(task, to, () => window.skaro.invoke('tasks.cancel', id, task.id));
    if (move === 'merge')
      void act(task, to, async () => {
        if ((await window.skaro.invoke('tasks.merge', id, task.id)) === 'merged') return true;
        // A blocked merge or no card: the user decides on the card in the task's feed.
        p.onopen(task.id);
        return false;
      });
  }

  async function confirmStart(assignment?: TaskAssignment): Promise<void> {
    const s = starting;
    starting = undefined;
    if (!s) return;
    try {
      await p.run([s.task.id], t('task.start.message'), assignment);
      s.done(true);
    } catch {
      s.done(false);
    }
  }

  function closeStart(): void {
    starting?.done(false);
    starting = undefined;
  }

  return {
    get columns() {
      return cols;
    },
    get starting() {
      return starting?.task;
    },
    ready: () => pendingDrop,
    allowed: (task: TaskSummary, from: ColumnKey, to: ColumnKey) =>
      moveOf(task, from, to) !== undefined,
    drop,
    confirmStart,
    closeStart,
  };
}

export type BoardMoves = ReturnType<typeof createBoardMoves>;
