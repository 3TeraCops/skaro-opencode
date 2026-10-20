import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires the separate real test project');

test('retains document row and group heights when expanding lists at normal and enlarged zoom', async ({
  browserName: _browserName,
}, info) => {
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async (project) => {
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: 'docs' },
      });
    }, project!);
    await page.reload();
    const tree = page.locator('.tree[data-doc-tree]');
    await expect(tree).toBeVisible();
    const groups = tree.locator('.group[data-doc-tree]');
    const sizes = async () =>
      tree.evaluate((element) => ({
        items: [...element.querySelectorAll('.item[data-doc-tree]')].map(
          (row) => row.getBoundingClientRect().height,
        ),
        groups: [...element.querySelectorAll('.group[data-doc-tree]')].map(
          (row) => row.getBoundingClientRect().height,
        ),
      }));
    const check = async () => {
      const actual = await sizes();
      expect(actual.items.length).toBeGreaterThan(2);
      for (const height of actual.items) expect(height).toBeCloseTo(32, 1);
      for (const height of actual.groups) expect(height).toBeCloseTo(28, 1);
      return actual;
    };
    const samples = [];
    for (const zoom of [1, 2, 3, 4, 5]) {
      await app.evaluate(({ BrowserWindow }, zoom) => {
        BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom);
      }, zoom);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      console.log(
        'Document viewport:',
        await tree.evaluate((element) => ({
          viewport: innerHeight,
          tree: element.getBoundingClientRect().height,
          items: element.querySelector('.items')!.getBoundingClientRect().height,
          scroll: element.querySelector('.items')!.scrollHeight,
        })),
      );
      for (let index = 0; index < (await groups.count()); index++) {
        const group = groups.nth(index);
        if (!(await group.locator('.chev.open').count())) continue;
        await group.press('Enter');
        await group.press('Enter');
        await expect(tree.locator('.windowed-content .item')).not.toHaveCount(0);
        samples.push({ zoom, group: index, ...(await check()) });
      }
    }
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1);
    });
    await page.screenshot({ path: info.outputPath('expanded-document-tree.png') });
    console.log('Actual document tree heights:', JSON.stringify(samples));
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1);
    });
    await app.close();
  }
});
