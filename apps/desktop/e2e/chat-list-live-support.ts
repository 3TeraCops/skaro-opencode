import { expect, type Locator, type Page } from '@playwright/test';

export async function chatListGeometry(row: Locator) {
  return row.evaluate((element) => {
    const css = getComputedStyle(element);
    const title = element.querySelector('.row-title')!;
    const text = getComputedStyle(title);
    return {
      height: element.getBoundingClientRect().height,
      minHeight: css.minHeight,
      padding: css.padding,
      gap: css.gap,
      radius: css.borderRadius,
      background: css.backgroundColor,
      color: text.color,
      font: text.font,
      overflow: text.textOverflow,
      whiteSpace: text.whiteSpace,
    };
  });
}
export async function collectChatRows(list: Locator) {
  const ids = new Set<string>();
  await list.evaluate((element) => (element.scrollTop = 0));
  let bottom = 0;
  for (let step = 0; step < 300; step++) {
    await list
      .page()
      .evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await expect(list.locator('.pending')).toHaveCount(0);
    for (const id of await list
      .locator('[data-chat-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-chat-id')!)))
      ids.add(id);
    const end = await list.evaluate((element) => {
      if (element.scrollTop >= element.scrollHeight - element.clientHeight - 2) return true;
      element.scrollTop += Math.max(100, element.clientHeight * 0.7);
      return false;
    });
    bottom = end ? bottom + 1 : 0;
    if (bottom === 3) return ids;
  }
  throw new Error('The real chat list did not reach its end');
}

/** Scroll the real list to the indexed position before using its ordinary row interaction. */
export async function revealChatRow(page: Page, project: string, id: string) {
  const list = page.locator('.sessions > .list');
  const row = list.locator(`[data-chat-id="${id}"]`);
  if (!(await row.count())) {
    const index = await page.evaluate(
      async ({ project, id }) => {
        const api = (window as unknown as { skaro: import('../src/shared/ipc').SkaroApi }).skaro;
        const catalog = await api.invoke('chats.query', project, false);
        return (await api.invoke('chats.find', catalog.source, id)).index;
      },
      { project, id },
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await list.evaluate((element, index) => {
      element.scrollTop = index * 32;
    }, index);
  }
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  return row;
}
