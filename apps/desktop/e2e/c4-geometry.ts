import { expect, type Locator } from '@playwright/test';

/** Inspect actual rendered SVG routes against actual node rectangles, including nested groups. */
export async function assertC4Endpoints(viewer: Locator, count: number): Promise<void> {
  await expect(viewer.locator('.svelte-flow__edge')).toHaveCount(count);
  const problems = await viewer.evaluate((root) => {
    const errors: string[] = [];
    for (const edge of root.querySelectorAll<SVGGElement>('.svelte-flow__edge')) {
      const endpoints = /^Edge from (\S+) to (\S+)$/.exec(edge.getAttribute('aria-label') ?? '');
      const path = edge.querySelector<SVGPathElement>('.svelte-flow__edge-path');
      if (!endpoints || !path) {
        errors.push(`Missing route metadata ${edge.dataset.id}`);
        continue;
      }
      for (const [id, length] of [
        [endpoints[1]!, 0],
        [endpoints[2]!, path.getTotalLength()],
      ] as const) {
        const node = root.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${id}"]`);
        if (!node) {
          errors.push(`Missing node ${id}`);
          continue;
        }
        const point = path.getPointAtLength(length).matrixTransform(path.getScreenCTM()!);
        const rect = node.getBoundingClientRect();
        if (
          point.x < rect.left - 3 ||
          point.x > rect.right + 3 ||
          point.y < rect.top - 3 ||
          point.y > rect.bottom + 3
        )
          errors.push(`${edge.dataset.id}: endpoint ${id} misses its node`);
      }
    }
    return errors;
  });
  expect(problems).toEqual([]);
}
