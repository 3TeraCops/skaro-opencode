import { tick } from 'svelte';
import type { PlanCatalog } from '../../../shared/plan-catalog';
import type StageCard from './StageCard.svelte';
import { t } from '@skaro/ui';
import type { MilestoneInfo } from '../../../shared/ipc';
import type { Stage } from './model';
import { createPlanDrag, type PlanDrag } from './plan-drag.svelte';
import type { PlanProps } from './plan-props';

export function createPlanController(getProps: () => PlanProps) {
  const p = $derived(getProps());
  /** "Архив этапов": archived tasks under their milestones instead of the plan. */
  let archiveView = $state(false);
  let openMap = $state<Record<string, boolean> | undefined>();
  let hovered = $state<string | undefined>();
  let modal = $state<{ kind: 'delete'; milestone: MilestoneInfo }>();
  let root = $state<HTMLElement | undefined>();
  let now = $state(Date.now());
  /** Why the last order to a stage was refused; the plan says it until it is closed. */
  let error = $state<string | undefined>();

  let catalog = $state.raw<PlanCatalog>();
  let relation = $state.raw<{ up: string[]; down: string[] }>({ up: [], down: [] });
  let refreshing = Promise.resolve();
  let pendingDrop = Promise.resolve();
  const views: Record<string, StageCard | undefined> = {};
  const localize = (stage: Stage) =>
    stage.loose ? { ...stage, milestone: { ...stage.milestone, title: t('plan.loose') } } : stage;
  const plan = $derived((catalog?.plan ?? []).map(localize));
  const archived = $derived((catalog?.archive ?? []).map(localize));
  const list = $derived(archiveView ? archived : plan);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Immutable relation snapshot.
  const rel = $derived({ up: new Set(relation.up), down: new Set(relation.down) });
  $effect(() => {
    void p.data.version;
    let cancelled = false;
    refreshing = window.skaro
      .invoke('plan.catalog', p.projectId)
      .then((value) => {
        if (!cancelled) catalog = value;
      })
      .catch((reason: unknown) => {
        if (!cancelled) refused('', reason);
      });
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    const id = hovered;
    void p.data.version;
    let cancelled = false;
    relation = { up: [], down: [] };
    if (id)
      void window.skaro
        .invoke('plan.relations', p.projectId, id)
        .then((value) => {
          if (!cancelled) relation = value;
        })
        .catch((reason: unknown) => {
          if (!cancelled) refused(id, reason);
        });
    return () => {
      cancelled = true;
    };
  });
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Immutable lookup of this snapshot.
  const stageInfo = $derived(new Map(p.data.stages.map((stage) => [stage.id, stage])));
  const anyOpen = $derived(list.some((s) => openMap?.[s.milestone.id]));
  const done = $derived(list.reduce((n, s) => n + s.done, 0));
  const total = $derived(list.reduce((n, s) => n + s.total, 0));
  const archiveTip = $derived(
    archiveView ? t('plan.archive.close') : t('plan.archive.open', { n: archived.length }),
  );

  const dnd = createPlanDrag({
    root: () => root,
    stages: () => plan,
    reveal: (id) => (openMap = { ...openMap, [id]: true }),
    revealRows: async (id, index) => {
      await tick();
      await views[id]?.reveal(index);
    },
    restoreFocus: async (drag) => {
      await pendingDrop;
      await refreshing;
      await tick();
      if (drag.kind === 'task') await views[drag.to]?.revealTask(drag.id);
    },
    ondrop: drop,
  });

  // At first the milestones still in work are open.
  $effect(() => {
    if (openMap || !catalog) return;
    openMap = Object.fromEntries(
      plan.map((s) => [s.milestone.id, s.total === 0 || s.done < s.total]),
    );
  });

  // The last group restored from the archive brings the plan back.
  $effect(() => {
    if (archiveView && !archived.length) archiveView = false;
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  function toggle(id: string): void {
    openMap = { ...openMap, [id]: !openMap?.[id] };
  }

  function drop(d: PlanDrag): void {
    if (d.kind === 'stage') {
      // "Без этапа" always closes the plan; only milestones are reordered.
      const ids = plan
        .filter((s) => !s.loose && s.milestone.id !== d.id)
        .map((s) => s.milestone.id);
      ids.splice(d.index, 0, d.id);
      pendingDrop = window.skaro
        .invoke('plan.reorder', p.projectId, ids)
        .then(() => p.data.reload())
        .catch((reason: unknown) => refused(d.id, reason));
    } else {
      openMap = { ...openMap, [d.to]: true };
      pendingDrop = window.skaro
        .invoke('plan.placeTask', p.projectId, d.id, d.to, d.index)
        .then(() => p.data.reload())
        .catch((reason: unknown) => refused(d.id, reason));
    }
  }

  /** "В архив" on the plan, "Вернуть из архива" in the archive: all tasks of the group. */
  function setArchived(stage: Stage, value: boolean): void {
    void window.skaro
      .invoke('plan.archiveGroup', p.projectId, stage.milestone.id, value)
      .catch((reason: unknown) => refused(stage.milestone.id, reason));
  }

  /** Where the stage of a milestone stands. */
  function info(id: string) {
    return stageInfo.get(id);
  }

  /** «Запустить» and «Продолжить» start the tasks of the stage in order; «Остановить» ends it. */
  function run(id: string, action: 'run' | 'stop'): void {
    error = undefined;
    const order =
      action === 'stop'
        ? window.skaro.invoke('stages.stop', p.projectId, id)
        : window.skaro.invoke('stages.run', p.projectId, id, t('task.start.message'));
    void order.catch((reason: unknown) => refused(id, reason));
  }

  function refused(id: string, reason: unknown): void {
    const text = reason instanceof Error ? reason.message : String(reason);
    error = `${id}: ${text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
  }

  function restoreTask(id: string): void {
    void window.skaro.invoke('tasks.archive', p.projectId, [id], false);
  }

  async function remove(milestone: MilestoneInfo): Promise<void> {
    modal = undefined;
    await window.skaro.invoke('plan.delete', p.projectId, milestone.id);
  }

  return {
    get p() {
      return p;
    },
    get archiveView() {
      return archiveView;
    },
    set archiveView(value: boolean) {
      archiveView = value;
    },
    get openMap() {
      return openMap;
    },
    set openMap(value: typeof openMap) {
      openMap = value;
    },
    get hovered() {
      return hovered;
    },
    set hovered(value: typeof hovered) {
      hovered = value;
    },
    get modal() {
      return modal;
    },
    set modal(value: typeof modal) {
      modal = value;
    },
    get root() {
      return root;
    },
    set root(value: HTMLElement | undefined) {
      root = value;
    },
    get now() {
      return now;
    },
    get error() {
      return error;
    },
    set error(value: string | undefined) {
      error = value;
    },
    get plan() {
      return plan;
    },
    get archived() {
      return archived;
    },
    get list() {
      return list;
    },
    get rel() {
      return rel;
    },
    get anyOpen() {
      return anyOpen;
    },
    get done() {
      return done;
    },
    get total() {
      return total;
    },
    get archiveTip() {
      return archiveTip;
    },
    dnd,
    info,
    run,
    toggle,
    setArchived,
    views,
    get loaded() {
      return !!catalog;
    },
    taskCount: (id: string) =>
      [...plan, ...archived].find((stage) => stage.milestone.id === id)?.allCount ?? 0,
    restoreTask,
    remove,
  };
}

export type PlanController = ReturnType<typeof createPlanController>;
