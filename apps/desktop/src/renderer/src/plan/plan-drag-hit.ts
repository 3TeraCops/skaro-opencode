// Where a milestone or a task dragged on the plan would land, read from the rendered list:
// `[data-stage]` — milestones that move, `[data-drop]` — milestones that take tasks,
// `[data-rows]` / `[data-row]` — the open task list and its rows.

/** Index of the pointer among `items`: before the first whose middle is below it. */
function indexAt(items: HTMLElement[], y: number, count = items.length): number {
  const i = items.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  const row = i < 0 ? items.at(-1) : items[i];
  const index = row?.closest<HTMLElement>('[data-plan-index]')?.dataset['planIndex'];
  return index === undefined ? (i < 0 ? count : i) : Math.min(count, Number(index) + Number(i < 0));
}

/**
 * The target under the pointer; undefined outside the milestones (the last target stays).
 * A collapsed milestone takes a task at its end (`count` — its tasks without the dragged one).
 */
export function planHit(
  root: HTMLElement,
  kind: 'stage' | 'task',
  x: number,
  y: number,
  count: (stage: string) => number,
): { to?: string; index: number } | undefined {
  if (kind === 'stage')
    return { index: indexAt([...root.querySelectorAll<HTMLElement>('[data-stage]')], y) };
  const stage = [...root.querySelectorAll<HTMLElement>('[data-drop]')].find((el) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (!stage) return undefined;
  const to = stage.dataset['drop'] ?? '';
  return {
    to,
    index: stage.querySelector('[data-rows]')
      ? indexAt([...stage.querySelectorAll<HTMLElement>('[data-row]')], y, count(to))
      : count(to),
  };
}
