import { tick, untrack } from 'svelte';
import { TaskRangeState } from '../tasks/range.svelte';
import type { StageController } from './stage-controller.svelte';
import type { TaskSummary } from '../../../shared/ipc';
import type { TaskLink } from '../../../shared/plan-catalog';

export function createPlanRows(p: () => StageController) {
  const range = new TaskRangeState(p().p.data, () => ({
    kind: 'plan',
    milestones: [p().m.id],
    archived: !!p().p.archived,
  }));
  const excluded = $derived(
    p().p.drag?.kind === 'task' && p().p.drag?.from === p().m.id ? (p().p.drag?.origin ?? -1) : -1,
  );
  const count = $derived(Math.max(0, p().p.stage.taskCount - Number(excluded >= 0)));
  const slot = $derived(p().slot?.index ?? -1);
  let revision = $state(0);
  let content = $state<{ reveal(index: number): Promise<void> }>();
  $effect(() => {
    void range.revision;
    void excluded;
    void slot;
    untrack(() => revision++);
  });
  async function read(start: number) {
    const omit = excluded,
      atSlot = slot;
    const positions = Array.from(
      { length: Math.min(16, Math.max(0, count + Number(atSlot >= 0) - start)) },
      (_, offset) => {
        const at = start + offset,
          index = at - Number(atSlot >= 0 && at > atSlot);
        return {
          at,
          index,
          source: at === atSlot ? -1 : index + Number(omit >= 0 && index >= omit),
        };
      },
    );
    const wanted = positions
      .filter((position) => position.source >= 0)
      .map((position) => position.source);
    const first = wanted.length ? Math.min(...wanted) : 0;
    const entries = wanted.length ? [...(await range.read(first))] : [];
    if (wanted.length && Math.max(...wanted) >= first + 16)
      entries.push(...(await range.read(first + 16)));
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Transient page lookup.
    const tasks = new Map(
      entries.flatMap((entry) => (entry.kind === 'task' ? [[entry.index, entry] as const] : [])),
    );
    return positions.map(({ at, index, source }) => {
      const entry = tasks.get(source);
      return {
        id: entry?.id ?? `slot:${at}`,
        index,
        task: entry?.task as TaskSummary | undefined,
        dependencies: entry?.dependencies ?? ([] as TaskLink[]),
      };
    });
  }
  async function reveal(index: number) {
    await tick();
    await content?.reveal(index + Number(slot >= 0 && index > slot));
  }
  async function revealTask(id: string) {
    const index = await range.find(id);
    if (index >= 0) await reveal(index);
  }
  return {
    range,
    read,
    reveal,
    revealTask,
    get count() {
      return count + Number(slot >= 0);
    },
    get revision() {
      return revision;
    },
    get content() {
      return content;
    },
    set content(value: typeof content) {
      content = value;
    },
  };
}
