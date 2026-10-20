// All project records and images come from the actual copied profile.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, WorkspaceState, TabsState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
test.skip(!profile, 'Requires an isolated real profile');

test('queries every real project and preserves the established grid, list and search', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const saved = await page.evaluate(async () => ({
    workspace: (await window.skaro.invoke('app.getSetting', 'ui.workspace')) as WorkspaceState,
    tabs: (await window.skaro.invoke('tabs.get')) as TabsState,
    view: await window.skaro.invoke('app.getSetting', 'ui.projects'),
  }));
  try {
    const actual = await page.evaluate(async () => {
      const projects = await window.skaro.invoke('projects.list');
      const first = await window.skaro.invoke('projects.query', { query: '', sort: 'name' });
      const cards = [...first.cards];
      for (let start = 48; start < first.source.count; start += 48)
        cards.push(...(await window.skaro.invoke('projects.page', first.source, start)));
      return { projects, cards, bootstrap: window.skaro.bootstrap };
    });
    expect(actual.cards.map((card) => card.id).sort()).toEqual(
      actual.projects.map((project) => project.id).sort(),
    );
    expect(actual.cards.map((card) => card.name)).toEqual(
      actual.cards.map((card) => card.name).sort((a, b) => a.localeCompare(b, 'ru')),
    );
    expect(actual.bootstrap!.projects.length).toBeLessThanOrEqual(
      32 + actual.bootstrap!.tabs.projects.length,
    );
    expect(
      actual.projects.every((project) => !project.logo || project.logo.startsWith('skaro-logo://')),
    ).toBe(true);
    await page.locator('.bar > .home').click();
    await page.getByRole('radio', { name: 'Сетка', exact: true }).click();
    await expect(page.locator('.projects .card').first()).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.projects img[src^="skaro-logo:"]')
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath('real-projects-grid.png') });
    await page.getByRole('radio', { name: 'Список', exact: true }).click();
    await page.getByRole('radio', { name: 'По названию', exact: true }).click();
    await expect(page.locator('.projects .item-row').first()).toBeVisible();
    const target = actual.projects.find((project) => !project.missing)!;
    const search = page.getByPlaceholder('Поиск по названию или пути');
    await search.fill(target.name);
    await expect(
      page.locator('.projects .item-row .name').filter({ hasText: target.name }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder('Поиск по названию или пути')).toHaveValue(target.name);
    await expect(
      page.locator('.projects .item-row .name').filter({ hasText: target.name }).first(),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('real-projects-list.png') });
    await page
      .locator('.projects .item-row')
      .filter({ has: page.getByText(target.name, { exact: true }) })
      .first()
      .click();
    await expect(page.locator('.project-nav > .head > .title')).toHaveText(target.name);
    console.log('Real project catalog:', {
      projects: actual.projects.length,
      bootstrap: actual.bootstrap!.projects.length,
    });
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async (saved) => {
      await window.skaro.invoke('app.setSetting', 'ui.workspace', saved.workspace);
      await window.skaro.invoke('tabs.set', saved.tabs);
      await window.skaro.invoke('app.setSetting', 'ui.projects', saved.view);
    }, saved);
    await app.close();
  }
});
