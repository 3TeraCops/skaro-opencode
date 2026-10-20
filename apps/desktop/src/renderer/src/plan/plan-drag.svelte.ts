// Dragging on the plan, the way cards are dragged on the board (board-drag.svelte.ts): pointer
// events with a ghost, a slot where it lands, keyboard moves (Space — take, arrows — move,
// Space — put) and spoken positions. Milestones change their order; tasks change their place and
// milestone. What a drop does is decided by the caller.

import { boardPointer } from '../tasks/board-pointer';
import type { TaskLink } from '../../../shared/plan-catalog';
import type { TaskSummary } from '../../../shared/ipc';
import { t } from '@skaro/ui';
import type { Stage } from './model';
import { planHit } from './plan-drag-hit';

export interface PlanDrag {
  kind: 'stage' | 'task';
  id: string;
  /** The milestone of a dragged task ("" — "Без этапа"); a dragged milestone — its own id. */
  from: string;
  to: string;
  /** Position among the milestones, or among the tasks of `to`, without the dragged one. */
  index: number;
  /** Where it was taken from: putting it back there changes nothing. */
  origin: number;
  task?: TaskSummary;
  dependencies?: TaskLink[];
  keyboard: boolean;
  /** The ghost: size, grab offset and pointer (pointer drags only). */
  w: number;
  h: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

const EDGE = 40;

export function createPlanDrag(options: {
  root: () => HTMLElement | undefined;
  stages: () => Stage[];
  revealRows: (stage: string, index: number) => Promise<void>;
  restoreFocus: (drag: PlanDrag) => Promise<void>;
  /** Opens a milestone the keyboard moves a task into. */
  reveal: (id: string) => void;
  ondrop: (drag: PlanDrag) => void;
}) {
  let drag = $state<PlanDrag | undefined>();
  let dropped = $state<string | undefined>();
  let live = $state('');
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let stopPointer: (() => void) | undefined;

  // A plan that goes away mid-drag leaves no listeners or cursor behind.
  $effect(() => () => {
    window.removeEventListener('keydown', keys, { capture: true });
    clearTimeout(dropTimer);
    stopPointer?.();
    end();
  });

  const movable = $derived(options.stages().filter((stage) => !stage.loose));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Immutable lookup of this snapshot.
  const byStage = $derived(new Map(options.stages().map((stage) => [stage.milestone.id, stage])));
  const others = (d: PlanDrag): number =>
    d.kind === 'stage'
      ? movable.length - 1
      : Math.max(0, (byStage.get(d.to)?.taskCount ?? 0) - Number(d.from === d.to));
  const stageName = (id: string): string => {
    const m = byStage.get(id)?.milestone;
    return m ? (m.id ? `${m.id} · ${m.title}` : m.title) : id;
  };

  function announce(d: PlanDrag): void {
    const total = others(d) + 1;
    live =
      d.kind === 'stage'
        ? t('plan.dnd.position.stage', { n: d.index + 1, total })
        : t('plan.dnd.position.task', { stage: stageName(d.to), n: d.index + 1, total });
  }

  /** Where the dragged item would land; outside the milestones the last target stays. */
  function hit(d: PlanDrag, x: number, y: number): { to: string; index: number } | undefined {
    const root = options.root();
    const h = root && planHit(root, d.kind, x, y, (to) => others({ ...d, to }));
    return h && { to: h.to ?? d.to, index: h.index };
  }

  function retarget(d: PlanDrag, to: string, index: number): void {
    const changed = d.to !== to || d.index !== index;
    drag = { ...d, to, index };
    if (changed && d.keyboard) {
      announce(drag);
      if (d.kind === 'task') void options.revealRows(to, index);
    }
  }

  /** Near the top or bottom edge of the plan the list scrolls. */
  function autoscroll(): void {
    const d = drag;
    const root = options.root();
    if (!d || d.keyboard || !root) return;
    const r = root.getBoundingClientRect();
    const speed =
      d.y < r.top + EDGE
        ? -(r.top + EDGE - d.y) / 3
        : d.y > r.bottom - EDGE
          ? (d.y - r.bottom + EDGE) / 3
          : 0;
    if (speed) {
      root.scrollTop += speed;
      const h = hit(d, d.x, d.y);
      if (h) retarget(d, h.to, h.index);
    }
    frame = requestAnimationFrame(autoscroll);
  }

  function end(): void {
    cancelAnimationFrame(frame);
    document.body.style.cursor = '';
  }

  function finish(): void {
    const d = drag;
    end();
    drag = undefined;
    if (!d) return;
    dropped = d.id;
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (dropped = undefined), 450);
    if (d.keyboard)
      live =
        d.kind === 'stage'
          ? t('plan.dnd.dropped.stage', { id: d.id, n: d.index + 1 })
          : t('plan.dnd.dropped.task', { id: d.id, stage: stageName(d.to), n: d.index + 1 });
    if (d.from !== d.to || d.index !== d.origin) options.ondrop(d);
  }

  function cancel(): void {
    const keyboard = drag?.keyboard;
    end();
    drag = undefined;
    if (keyboard) live = t('plan.dnd.cancelled');
  }

  function indexOf(kind: PlanDrag['kind'], id: string, event: Event): number {
    if (kind === 'stage')
      return Math.max(
        0,
        movable.findIndex((stage) => stage.milestone.id === id),
      );
    return Number(
      (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-plan-index]')?.dataset[
        'planIndex'
      ] ?? 0,
    );
  }

  function down(
    kind: PlanDrag['kind'],
    id: string,
    from: string,
    event: PointerEvent,
    task?: TaskSummary,
    dependencies?: TaskLink[],
  ): void {
    if (event.button !== 0 || drag) return;
    stopPointer?.();
    const index = indexOf(kind, id, event);
    stopPointer = boardPointer(event, {
      start: (rect, x, y) => {
        drag = {
          kind,
          id,
          task,
          dependencies,
          from,
          to: from,
          index,
          origin: index,
          keyboard: false,
          w: rect.width,
          h: rect.height,
          ox: x - rect.left,
          oy: y - rect.top,
          x,
          y,
        };
        document.body.style.cursor = 'grabbing';
        frame = requestAnimationFrame(autoscroll);
      },
      move: (next) => {
        const d = drag;
        if (!d) return;
        drag = { ...d, x: next.clientX, y: next.clientY };
        const target = hit(drag, next.clientX, next.clientY);
        if (target) retarget(drag, target.to, target.index);
      },
      finish,
      cancel,
    });
  }

  /** A task moved by the keyboard past the edge of its milestone goes to the neighbour. */
  function step(d: PlanDrag, delta: -1 | 1): void {
    if (d.kind === 'stage') {
      retarget(d, d.to, Math.max(0, Math.min(others(d), d.index + delta)));
      return;
    }
    const next = d.index + delta;
    if (next >= 0 && next <= others(d)) {
      retarget(d, d.to, next);
      return;
    }
    const list = options.stages();
    const neighbour = list[list.findIndex((s) => s.milestone.id === d.to) + delta];
    if (!neighbour) return;
    const to = neighbour.milestone.id;
    options.reveal(to);
    retarget(d, to, delta < 0 ? others({ ...d, to }) : 0);
  }

  /** Keys while an item is taken from the keyboard: arrows move, Space or Enter put, Esc cancels. */
  function keys(e: KeyboardEvent): void {
    const d = drag;
    if (!d?.keyboard) return;
    if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === ' ' || e.key === 'Enter') release(d, finish);
    else if (e.key === 'Escape') release(d, cancel);
    else step(d, e.key === 'ArrowUp' ? -1 : 1);
  }

  /** Ends a keyboard move and puts the focus back on the item, wherever it landed. */
  function release(d: PlanDrag, done: () => void): void {
    window.removeEventListener('keydown', keys, { capture: true });
    done();
    const attr = d.kind === 'stage' ? 'data-stage-head' : 'data-row';
    void options.restoreFocus(done === cancel ? { ...d, to: d.from } : d).then(() =>
      options
        .root()
        ?.querySelector<HTMLElement>(`[${attr}="${CSS.escape(d.id)}"]`)
        ?.focus(),
    );
  }

  /** Space on a focused milestone or task takes it; it leaves the list, its slot moves. */
  function keydown(
    kind: PlanDrag['kind'],
    id: string,
    from: string,
    e: KeyboardEvent,
    task?: TaskSummary,
    dependencies?: TaskLink[],
  ): void {
    if (drag || e.key !== ' ') return;
    e.preventDefault();
    const index = indexOf(kind, id, e);
    drag = {
      kind,
      id,
      task,
      dependencies,
      from,
      to: from,
      index,
      origin: index,
      keyboard: true,
      w: 0,
      h: (e.currentTarget as HTMLElement).offsetHeight,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
    };
    live = t(kind === 'stage' ? 'plan.dnd.picked.stage' : 'plan.dnd.picked.task', { id });
    window.addEventListener('keydown', keys, { capture: true });
  }

  return {
    get drag() {
      return drag;
    },
    get dropped() {
      return dropped;
    },
    get live() {
      return live;
    },
    down,
    keydown,
  };
}

export type PlanDragController = ReturnType<typeof createPlanDrag>;
