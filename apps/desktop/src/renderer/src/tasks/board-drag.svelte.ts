// Dragging cards on the board (Skaro UI v2 mockup): pointer events with a ghost of the card, a
// slot where it lands, keyboard moves (Space — take, arrows — move, Space — put) and spoken
// positions. What a move does is decided by the caller (board-moves.ts).

import { t } from '@skaro/ui';
import { boardPointer } from './board-pointer';
import type { TaskSummary } from '../../../shared/ipc';
import type { ColumnKey } from './board-moves';

export interface Drag {
  task: TaskSummary;
  from: ColumnKey;
  originIndex: number;
  to: ColumnKey;
  /** Position in the target column without the dragged card. */
  index: number;
  allowed: boolean;
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
const KEYS: ColumnKey[] = ['todo', 'working', 'review', 'done'];

export function createBoardDrag(options: {
  root: () => HTMLElement | undefined;
  reveal(key: ColumnKey, index: number): Promise<void> | undefined;
  revealCard(id: string): Promise<void>;
  columns: () => { key: ColumnKey; count: number }[];
  allowed: (task: TaskSummary, from: ColumnKey, to: ColumnKey) => boolean;
  ondrop: (task: TaskSummary, from: ColumnKey, to: ColumnKey, index: number) => void;
}) {
  let drag = $state<Drag | undefined>();
  let dropped = $state<string | undefined>();
  let live = $state('');
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let revealFrame = 0;
  let stopPointer: (() => void) | undefined;

  // A board that goes away mid-drag leaves no listeners or cursor behind.
  $effect(() => () => {
    window.removeEventListener('keydown', keys, { capture: true });
    clearTimeout(dropTimer);
    stopPointer?.();
    end();
  });

  const others = (key: ColumnKey): number =>
    Math.max(
      0,
      (options.columns().find((col) => col.key === key)?.count ?? 0) - Number(drag?.from === key),
    );
  const columnName = (key: ColumnKey): string => t(`board.col.${key}`);
  const short = (task: TaskSummary): string => task.id.replace(/^T-0*(\d+)$/, 'T$1');

  function announce(d: Drag): void {
    const total = others(d.to) + 1;
    live = d.allowed
      ? t('board.dnd.position', { column: columnName(d.to), n: d.index + 1, total })
      : t('board.dnd.forbidden', { column: columnName(d.to) });
  }

  /** The column and position under the pointer; outside the columns the last target stays. */
  function hit(x: number, y: number): { to: ColumnKey; index: number } | undefined {
    const root = options.root();
    if (!root) return undefined;
    const col = [...root.querySelectorAll<HTMLElement>('[data-col]')].find((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!col) return undefined;
    const cards = [...col.querySelectorAll<HTMLElement>('[data-card]')];
    const position = (card: HTMLElement) =>
      Number(card.closest<HTMLElement>('[data-task-index]')?.dataset['taskIndex'] ?? 0);
    let index = cards.length ? position(cards.at(-1)!) + 1 : 0;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = position(cards[i]!);
        break;
      }
    }
    return { to: col.dataset['col'] as ColumnKey, index };
  }

  function retarget(d: Drag, to: ColumnKey, index: number): void {
    const allowed = options.allowed(d.task, d.from, to);
    const changed = d.to !== to || d.index !== index || d.allowed !== allowed;
    drag = { ...d, to, index, allowed };
    document.body.style.cursor = d.keyboard ? '' : allowed ? 'grabbing' : 'not-allowed';
    if (changed && d.keyboard) {
      announce(drag);
      cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        const current = drag;
        if (current?.keyboard) void options.reveal(current.to, current.index);
      });
    }
  }

  /** Near the top or bottom edge of a column the column scrolls. */
  function autoscroll(): void {
    const d = drag;
    const root = options.root();
    if (!d || d.keyboard || !root) return;
    const list = root.querySelector<HTMLElement>(`[data-col="${d.to}"] [data-scroll]`);
    if (list) {
      const r = list.getBoundingClientRect();
      const speed =
        d.y < r.top + EDGE
          ? -(r.top + EDGE - d.y) / 3
          : d.y > r.bottom - EDGE
            ? (d.y - r.bottom + EDGE) / 3
            : 0;
      if (speed) {
        list.scrollTop += speed;
        const h = hit(d.x, d.y);
        if (h) retarget(d, h.to, h.index);
      }
    }
    frame = requestAnimationFrame(autoscroll);
  }

  function end(): void {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(revealFrame);
    document.body.style.cursor = '';
  }

  function finish(): void {
    const d = drag;
    end();
    drag = undefined;
    if (!d) return;
    if (!d.allowed) {
      if (d.keyboard) live = t('board.dnd.cancelled');
      return;
    }
    dropped = d.task.id;
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (dropped = undefined), 450);
    if (d.keyboard)
      live = t('board.dnd.dropped', {
        task: short(d.task),
        column: columnName(d.to),
        n: d.index + 1,
      });
    options.ondrop(d.task, d.from, d.to, d.index);
  }

  function cancel(): void {
    const keyboard = drag?.keyboard;
    end();
    drag = undefined;
    if (keyboard) live = t('board.dnd.cancelled');
  }

  /** Pointer down on a card: a drag starts after 5px, a shorter press stays a click. */
  function down(task: TaskSummary, from: ColumnKey, e: PointerEvent): void {
    if (e.button !== 0 || drag) return;
    stopPointer?.();
    const originIndex = Number(
      (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-task-index]')?.dataset[
        'taskIndex'
      ] ?? 0,
    );
    stopPointer = boardPointer(e, {
      start: (r, sx, sy) => {
        drag = {
          task,
          from,
          originIndex,
          to: from,
          index: originIndex,
          allowed: true,
          keyboard: false,
          w: r.width,
          h: r.height,
          ox: sx - r.left,
          oy: sy - r.top,
          x: sx,
          y: sy,
        };
        document.body.style.cursor = 'grabbing';
        frame = requestAnimationFrame(autoscroll);
      },
      move: (event) => {
        const d = drag;
        if (!d) return;
        drag = { ...d, x: event.clientX, y: event.clientY };
        const target = hit(event.clientX, event.clientY);
        if (target) retarget(drag, target.to, target.index);
      },
      finish: () => {
        if (drag) finish();
      },
      cancel,
    });
  }

  /** Keys while a card is taken from the keyboard: arrows move, Space or Enter put, Esc cancels. */
  function keys(e: KeyboardEvent): void {
    const d = drag;
    if (!d?.keyboard) return;
    if (
      ![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === ' ' || e.key === 'Enter') release(d.task.id, finish);
    else if (e.key === 'Escape') release(d.task.id, cancel);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const last = others(d.to);
      retarget(d, d.to, Math.max(0, Math.min(last, d.index + (e.key === 'ArrowUp' ? -1 : 1))));
    } else {
      const next = KEYS[KEYS.indexOf(d.to) + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (next) retarget(d, next, Math.min(d.index, others(next)));
    }
  }

  /** Ends a keyboard move and puts the focus back on the card, wherever it landed. */
  function release(id: string, done: () => void): void {
    window.removeEventListener('keydown', keys, { capture: true });
    done();
    void options.revealCard(id).then(() =>
      options
        .root()
        ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  }

  /** Space on a focused card takes it; the card leaves the list, its slot moves with the arrows. */
  function keydown(task: TaskSummary, from: ColumnKey, e: KeyboardEvent): void {
    if (drag || e.key !== ' ') return;
    e.preventDefault();
    const originIndex = Number(
      (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-task-index]')?.dataset[
        'taskIndex'
      ] ?? 0,
    );
    drag = {
      task,
      from,
      originIndex,
      to: from,
      index: originIndex,
      allowed: true,
      keyboard: true,
      w: 0,
      h: (e.currentTarget as HTMLElement).offsetHeight,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
    };
    live = t('board.dnd.picked', { task: short(task) });
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

export type BoardDrag = ReturnType<typeof createBoardDrag>;
