import { expect, type Locator } from '@playwright/test';
/** Collect the real mounted rows while scrolling; no synthetic rows or backend replacement. */
export async function collectPlanRows(scroller: Locator) {
  const ids = new Set<string>();
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  let bottom = 0;
  for (let step = 0; step < 300; step++) {
    await scroller
      .page()
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await expect(scroller.locator('.pending')).toHaveCount(0);
    for (const id of await scroller
      .locator('[data-row]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row')!)))
      ids.add(id);
    const atBottom = await scroller.evaluate((element) => {
      const end = element.scrollHeight - element.clientHeight;
      if (element.scrollTop >= end - 2) return true;
      element.scrollTop += Math.max(100, element.clientHeight * 0.7);
      return false;
    });
    bottom = atBottom ? bottom + 1 : 0;
    if (bottom >= 3) return ids;
  }
  throw new Error('Real plan did not reach its end');
}
