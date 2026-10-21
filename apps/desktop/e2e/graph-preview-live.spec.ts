import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './launch';

const evidence = process.env.SKARO_GRAPH_EVIDENCE;
const html = evidence ? join(evidence, 'chatballs-graph.html') : '';
test.skip(!html || !existsSync(html), 'Requires the exported, genuine C4 visual preview');

test('autonomous C4 preview preserves the corrected native navigation and zoom', async () => {
  test.setTimeout(90_000);
  const app = await launchApp(join(evidence!, 'offline-profile'), { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await page.locator('.app').waitFor();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(async ({ BrowserWindow }, path) => {
      await BrowserWindow.getAllWindows()[0]!.webContents.loadFile(path);
    }, html);
    await page.locator('.sigma-host[data-layout-ready="true"]').waitFor({ timeout: 30_000 });
    await expect(page.locator('.graph-canvas')).toHaveAttribute('data-node-count', '140');
    await page.getByRole('spinbutton').fill('150%');
    await page.getByRole('spinbutton').press('Enter');
    await expect(page.getByRole('spinbutton')).toHaveText('150%');
    await page.getByRole('button', { name: 'C4', exact: true }).click();
    await page.locator('[data-c4-element]').first().waitFor({ timeout: 30_000 });
    await page.getByRole('spinbutton').fill('125%');
    await page.getByRole('spinbutton').press('Enter');
    await expect(page.getByRole('spinbutton')).toHaveText('125%');
    await page.screenshot({ path: join(evidence!, 'offline-c4.png') });
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Граф связей', exact: true })
      .click();
    await page.locator('.sigma-host[data-layout-ready="true"]').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(evidence!, 'offline-html.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    const frame = await page.locator('.sigma-host').getAttribute('data-motion-frame');
    await page.waitForTimeout(300);
    expect(await page.locator('.sigma-host').getAttribute('data-motion-frame')).toBe(frame);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect
      .poll(() => page.locator('.sigma-host').getAttribute('data-motion-frame'))
      .not.toBe(frame);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
