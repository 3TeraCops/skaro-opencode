import { tick, untrack } from 'svelte';
import type { BoardMoves } from './board-moves-controller.svelte';
import type { BoardDrag } from './board-drag.svelte';
import type { TaskRange } from '../../../shared/task-catalog';
import type { TaskSummary } from '../../../shared/ipc';
import type { TaskSelection } from './task-selection.svelte';
export interface BoardColumnProps {
  col: BoardMoves['columns'][number];
  dnd: BoardDrag;
  selection: TaskSelection;
  selecting: boolean;
  now: number;
  onselect(id: string, on: boolean, task?: TaskSummary): void;
  onselectcolumn(source: TaskRange, on: boolean): void;
  onopen(id: string): void;
}
export function createBoardColumn(p: () => BoardColumnProps) {
  const excluded = $derived(p().dnd.drag?.from === p().col.key ? p().dnd.drag?.task.id : undefined);
  const origin = $derived(p().dnd.drag?.originIndex ?? -1);
  let excludedIndex = $state(-1);
  $effect(() => {
    void p().col.range.revision;
    const id = excluded,
      index = origin;
    if (!id) {
      excludedIndex = -1;
      return;
    }
    excludedIndex = index;
    let cancelled = false;
    void p()
      .col.range.find(id)
      .then((at) => {
        if (!cancelled) excludedIndex = at;
      });
    return () => {
      cancelled = true;
    };
  });
  const count = $derived(Math.max(0, p().col.range.count - Number(excludedIndex >= 0)));
  const slot = $derived(
    p().dnd.drag?.to === p().col.key && p().dnd.drag?.allowed ? p().dnd.drag!.index : -1,
  );
  const height = $derived(p().dnd.drag?.h || 76);
  const over = $derived(slot >= 0 && p().dnd.drag?.from !== p().col.key);
  const allSelected = $derived(p().selection.all(p().col.range.source));
  let revision = $state(0);
  let content = $state<{ reveal(index: number): Promise<void> }>();
  $effect(() => {
    void p().col.range.revision;
    void excludedIndex;
    void slot;
    void height;
    untrack(() => revision++);
  });
  async function read(start: number) {
    const excluded = excludedIndex,
      atSlot = slot;
    const positions = Array.from(
      { length: Math.min(16, Math.max(0, count + Number(atSlot >= 0) - start)) },
      (_, offset) => {
        const at = start + offset,
          position = at - Number(atSlot >= 0 && at > atSlot);
        return {
          id: String(at),
          index: position,
          source: at === atSlot ? -1 : position + Number(excluded >= 0 && position >= excluded),
        };
      },
    );
    const wanted = positions.filter((value) => value.source >= 0).map((value) => value.source);
    if (!wanted.length)
      return positions.map(({ index }) => ({
        id: `slot:${index}`,
        index,
        task: undefined as TaskSummary | undefined,
      }));
    const first = Math.min(...wanted),
      last = Math.max(...wanted);
    const entries = [...(await p().col.range.read(first))];
    if (last >= first + 16) entries.push(...(await p().col.range.read(first + 16)));
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Transient lookup rebuilt from the current read.
    const tasks = new Map(
      entries.flatMap((entry) =>
        entry.kind === 'task' ? [[entry.index, entry.task] as const] : [],
      ),
    );
    return positions.map(({ index, source }) => {
      const task = tasks.get(source);
      return { id: task?.id ?? `slot:${index}`, index, task };
    });
  }
  async function revealCard(id: string) {
    await tick();
    const index = await p().col.range.find(id);
    if (index >= 0) await content?.reveal(index + Number(slot >= 0 && index >= slot));
  }
  return {
    get count() {
      return count;
    },
    get slot() {
      return slot;
    },
    get height() {
      return height;
    },
    get over() {
      return over;
    },
    get revision() {
      return revision;
    },
    get allSelected() {
      return allSelected;
    },
    get content() {
      return content;
    },
    set content(value: typeof content) {
      content = value;
    },
    read,
    revealCard,
    revealSlot: (index: number) => content?.reveal(index),
  };
}
