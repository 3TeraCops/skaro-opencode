import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';
import { assertC4Endpoints } from './c4-geometry';

declare const window: Window & { skaro: SkaroApi };
const root = process.env.SKARO_C4_VERIFY_ROOT;
test.skip(!root, 'Opt-in: real checkout containing the accepted Skaro C4 package');

test('native documents show full-width C4 previews and an interactive fullscreen canvas', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(180_000);
  const app = await launchApp(join(root!, 'output/c4-profile'));
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage))
        if (key.startsWith('skaro.c4.')) localStorage.removeItem(key);
    });
    await page.evaluate(async (path) => {
      const project = await window.skaro.invoke('projects.add', path);
      await window.skaro.invoke('tabs.set', { projects: [project.id], active: project.id });
      await window.skaro.invoke('app.setLocale', 'ru');
    }, root!);
    await page.reload();
    await page
      .locator('.project-nav')
      .getByRole('button', { name: /^Документы/ })
      .click();
    await page.getByText('Архитектура', { exact: true }).first().click();
    const preview = page.locator('[data-c4-preview="containers"]');
    await preview.scrollIntoViewIfNeeded();
    await expect(preview.locator('.c4-preview-svg')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.c4-error')).toHaveCount(0);
    const width = await preview.evaluate((element) => ({
      preview: element.getBoundingClientRect().width,
      document: element.closest('.blocks')!.getBoundingClientRect().width,
    }));
    expect(Math.abs(width.preview - width.document)).toBeLessThan(2);
    await preview.screenshot({ path: testInfo.outputPath('c4-preview.png') });
    await preview.getByRole('button').click();
    const viewer = page.locator('.c4-viewer-dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-c4-element="renderer"]')).toBeVisible({ timeout: 30_000 });
    await expect(viewer.locator('.c4-loading')).toHaveCount(0);
    const viewport = viewer.locator('.svelte-flow__viewport');
    const initial = await viewport.getAttribute('style');
    expect(Number(/scale\(([^)]+)\)/.exec(initial!)?.[1])).toBeGreaterThan(0.05);
    await viewer.getByRole('button', { name: 'Приблизить', exact: true }).click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(initial);
    const canvas = await viewer.locator('.c4-canvas').boundingBox();
    const beforePan = await viewport.getAttribute('style');
    await page.mouse.move(canvas!.x + 22, canvas!.y + 22);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + 100, canvas!.y + 85, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforePan);
    await viewer.getByRole('button', { name: 'Полный экран', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.fullscreenElement?.classList.contains('c4-viewer-dialog')),
      )
      .toBe(true);
    await viewer.getByRole('button', { name: 'Показать целиком', exact: true }).click();
    await expect(viewer.locator('[data-c4-element="renderer"]')).toBeInViewport();
    await assertC4Endpoints(viewer, 7);
    await page.screenshot({ path: testInfo.outputPath('c4-fullscreen.png') });
    await viewer.getByRole('button', { name: 'Выйти из полного экрана', exact: true }).click();
    const saved = await viewport.getAttribute('style');
    await viewer.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await preview.getByRole('button').click();
    await expect(viewer).toBeVisible();
    await expect
      .poll(() => viewer.locator('.svelte-flow__viewport').getAttribute('style'))
      .toBe(saved);
    await viewer.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(viewer).toHaveCount(0);
    await preview.getByRole('button').click();
    await chooseView('Архитектура и приёмка в main process');
    await expect(viewer.locator('[data-c4-element="c4service"]')).toBeVisible();
    await viewer.locator('[data-c4-element="c4service"]').click();
    await expect(viewer.locator('.c4-details')).toContainText('C4Service');
    await viewer
      .locator('.c4-details')
      .getByRole('button', { name: 'Открыть внутреннее устройство' })
      .click();
    await expect(viewer.getByRole('button', { name: 'Представление', exact: true })).toContainText(
      'Код сервиса C4',
    );
    await viewer.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Представление', exact: true })).toContainText(
      'Архитектура и приёмка',
    );
    await expect(viewer.getByRole('textbox')).toHaveCount(1);
    await expect(viewer.getByRole('button', { name: 'Приблизить выбранное' })).toHaveCount(0);
    await viewer.getByRole('textbox', { name: 'Найти элемент' }).fill('assertC4TaskReview');
    await viewer.getByRole('option').filter({ hasText: 'assertC4TaskReview' }).click();
    await expect(viewer.getByRole('button', { name: 'Представление', exact: true })).toContainText(
      'Код сервиса C4',
    );
    await expect(viewer.locator('[data-c4-element="codereview"]')).toBeInViewport({ ratio: 0.9 });
    await expect(viewer.locator('.c4-details')).toContainText('assertC4TaskReview');
    await expect
      .poll(async () =>
        Number(
          /scale\(([^)]+)\)/.exec(
            (await viewer.locator('.svelte-flow__viewport').getAttribute('style'))!,
          )?.[1],
        ),
      )
      .toBeGreaterThan(0.5);
    // Searching again after navigation and zooming must still restore a readable focus.
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let step = 0; step < 4; step++)
        await viewer.getByRole('button', { name: 'Отдалить', exact: true }).click();
      await viewer.getByRole('textbox', { name: 'Найти элемент' }).fill('C4Service');
      await viewer.getByRole('option').filter({ hasText: 'TypeScript class' }).click();
      await expect(viewer.locator('[data-c4-element="serviceclass"]')).toBeInViewport({
        ratio: 0.9,
      });
      await expect(viewer.locator('.c4-canvas-tools > span')).toHaveText('100%');
      await viewer.getByRole('button', { name: 'Назад', exact: true }).click();
    }
    await viewer.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Представление', exact: true })).toContainText(
      'Архитектура и приёмка',
    );
    await chooseView('Согласование и публикация C4');
    await expect(viewer.locator('.c4-edge-label')).toHaveCount(5);
    await chooseView('Локальное развёртывание Skaro');
    await expect(viewer.locator('[data-c4-element="database"]')).toBeVisible();
    await assertC4Endpoints(viewer, 2);
    await page.screenshot({ path: testInfo.outputPath('c4-deployment.png') });
    await viewer.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByText('C4 в Skaro', { exact: true }).first().click();
    await expect(page.locator('[data-c4-preview="maincomponents"]')).toBeVisible();
    expect(errors).toEqual([]);
    async function chooseView(title: string): Promise<void> {
      await viewer.getByRole('button', { name: 'Представление', exact: true }).click();
      await viewer.getByRole('option').filter({ hasText: title }).click();
      await expect(viewer.locator('.c4-loading')).toHaveCount(0);
    }
  } finally {
    await app.close();
  }
});
