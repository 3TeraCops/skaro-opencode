import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires the separate real test project');

test('keeps a complete real document accessible through the shared paged viewport', async ({
  browserName: _browserName,
}, info) => {
  const source = await readFile(join(__dirname, '../../../docs/agent-output.md'), 'utf8');
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(
      async ({ project, source }) => {
        const path = '.skaro/docs/windowed-refresh.md';
        if (!(await window.skaro.invoke('docs.lookup', project, { path })))
          await window.skaro.invoke('docs.create', project, 'windowed-refresh');
        await window.skaro.invoke('docs.write', project, path, source);
        await window.skaro.invoke('tabs.set', { projects: [project], active: project });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'docs' },
          openChats: {},
          openTasks: {},
        });
        localStorage.setItem(`skaro.doc.${project}`, path);
      },
      { project: project!, source },
    );
    await page.reload();
    const body = page.locator('[data-doc-article].blocks');
    await expect(body.locator('.md').first()).toBeVisible();
    const rows = body.locator('.windowed-content > [data-feed-block]');
    await expect.poll(() => rows.count()).toBeLessThan(60);
    const toc = page.locator('[data-doc-page] .toc-item');
    if (!(await toc.count()))
      await page.getByRole('button', { name: 'На странице', exact: true }).click();
    const last = toc.last();
    const title = await last.innerText();
    await last.click();
    const headings = body.locator('h1,h2,h3,h4,h5,h6');
    await expect(headings.filter({ hasText: title }).last()).toBeVisible();
    await expect(body.locator('.pending')).toHaveCount(0);
    await headings.last().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await expect(page.locator('textarea[data-doc-editor]')).toHaveValue(source);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(
      await page.evaluate(
        (project) => window.skaro.invoke('docs.read', project, '.skaro/docs/windowed-refresh.md'),
        project!,
      ),
    ).toBe(source);
    await page.screenshot({ path: info.outputPath('real-document-in-test-project.png') });
    expect(errors).toEqual([]);
    console.log(
      'Real document in separate project:',
      JSON.stringify({
        characters: source.length,
        mounted: await rows.count(),
      }),
    );
  } finally {
    await app.close();
  }
});
