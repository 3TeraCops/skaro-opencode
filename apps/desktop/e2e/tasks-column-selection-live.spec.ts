import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_SELECTION_PROFILE'];
const projectId = process.env['SKARO_SELECTION_PROJECT'];

test.skip(!profile || !projectId, 'Requires a real configured profile and existing project');

test('column selection follows visible tasks and preserves selection in other columns', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  // Actual Electron, native IPC and existing tasks only; no generated project data.
  const app = await launchApp(profile!);
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.skaro);
  const previous = await page.evaluate(
    async (id) => ({
      tabs: await window.skaro.invoke('tabs.get'),
      view: await window.skaro.invoke('app.getSetting', `tasks.${id}.view`),
    }),
    projectId!,
  );
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(async (id) => {
      await window.skaro.invoke('tabs.set', { projects: [id], active: id });
      await window.skaro.invoke('app.setSetting', `tasks.${id}.view`, 'board');
    }, projectId!);
    await page.reload();
    await page
      .locator('.project-nav')
      .getByRole('button', { name: /^Задачи/ })
      .click();
    const board = page.locator('.board');
    const columns = board.locator(':scope > .col');
    await expect(columns).toHaveCount(4);
    await expect(board.locator('[data-card]').first()).toBeVisible({ timeout: 60_000 });
    await expect(board.locator('.head').getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('before-selecting.png') });
    const pick = page.getByRole('button', { name: 'Выбрать несколько', exact: true });
    await pick.click();
    await expect(board.locator('.head').getByRole('checkbox', { name: 'Все' })).toHaveCount(4);

    const counts = await Promise.all(
      (await columns.all()).map((col) => col.locator('[data-card]').count()),
    );
    const populated = counts.flatMap((count, index) => (count ? [index] : []));
    expect(populated.length, 'Real project must have two populated columns').toBeGreaterThanOrEqual(
      2,
    );
    const first = columns.nth(populated[0]!);
    const other = columns.nth(populated[1]!);
    const all = first.locator('.head').getByRole('checkbox', { name: 'Все' });
    const otherAll = other.locator('.head').getByRole('checkbox', { name: 'Все' });
    const cards = first.locator('[data-card]');
    const count = await cards.count();
    expect(count, 'Real column must have multiple tasks').toBeGreaterThan(1);
    await all.click();
    await expect(all).toBeChecked();
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(count);
    await otherAll.click();
    await expect(otherAll).toBeChecked();
    // Two real UI actions before the worker response: the later single-card intent must win.
    await first.evaluate(async (column) => {
      (column.querySelector('.head [role="checkbox"]') as HTMLElement).click();
      await Promise.resolve();
      (column.querySelector('[data-card] [role="checkbox"]') as HTMLElement).click();
    });
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(1);
    await expect(all).not.toBeChecked();
    await expect(otherAll).toBeChecked();
    await all.click();
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(count);
    await cards.first().getByRole('checkbox').click();
    await expect(all).not.toBeChecked();
    await all.click();
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(count);
    await page.screenshot({ path: testInfo.outputPath('all-selected.png') });
    await all.click();
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);
    await expect(otherAll).toBeChecked();

    // Filtering narrows the column operation; selections in hidden tasks survive.
    const id = await cards.first().getAttribute('data-card');
    const search = page.getByPlaceholder('Поиск по названию и ID');
    await search.fill(id!);
    await expect(cards).toHaveCount(1);
    await all.click();
    await expect(cards.first().getByRole('checkbox')).toBeChecked();
    await search.fill('');
    await expect(cards).toHaveCount(count);
    await expect(cards.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(1);
    await expect(all).not.toBeChecked();
    await expect(otherAll).toBeChecked();
    for (const [index, size] of counts.entries()) {
      if (size) continue;
      const emptyAll = columns.nth(index).locator('.head').getByRole('checkbox', { name: 'Все' });
      await emptyAll.click();
      await expect(emptyAll).not.toBeChecked();
    }
    await pick.click();
    await expect(board.getByRole('checkbox')).toHaveCount(0);
    await pick.click();
    await expect(board.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);
    await pick.click();
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(
      async ({ id, previous }) => {
        await window.skaro.invoke('tabs.set', previous.tabs);
        await window.skaro.invoke('app.setSetting', `tasks.${id}.view`, previous.view);
      },
      { id: projectId!, previous },
    );
    await app.close();
  }
});
