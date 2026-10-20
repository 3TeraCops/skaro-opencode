import type { Locator } from '@playwright/test';

/** Observe the native click and first paint of the existing content/loading state. */
export async function recordFeedback(row: Locator, content: string, attribute = 'feedbackMs') {
  await row.evaluate(
    (node, { selector, attribute }) => {
      let start = 0;
      node.addEventListener(
        'pointerup',
        () => {
          start = performance.now();
        },
        { once: true },
      );
      const observer = new MutationObserver(() => {
        if (!start || !node.querySelector(selector)) return;
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            (node as HTMLElement).dataset[attribute] = String(performance.now() - start);
          }),
        );
      });
      observer.observe(node, { childList: true, subtree: true });
    },
    { selector: content, attribute },
  );
  return async () =>
    Number(
      await row.evaluate((node, key) => (node as HTMLElement).dataset[key] ?? null, attribute),
    );
}
