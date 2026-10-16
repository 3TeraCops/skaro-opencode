import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_INTEGRATION_PROFILE'];
const projectId = process.env['SKARO_INTEGRATION_PROJECT'];
const taskId = process.env['SKARO_INTEGRATION_TASK'];
test.skip(
  !profile || !projectId || !taskId,
  'Requires an isolated snapshot of actual failed task history',
);

test('a real pre-session dependency conflict is visible in the existing task error banner', async ({
  playwright: _playwright,
}, testInfo) => {
  const app = await launchApp(profile!);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await page.evaluate(async (projectId) => {
      await window.skaro.invoke('tabs.set', { projects: [projectId], active: projectId });
      await window.skaro.invoke('app.setSetting', 'ui.navCollapsed', false);
    }, projectId!);
    await page.reload();
    const actual = await page.evaluate(
      ({ projectId, taskId }) => window.skaro.invoke('task.open', projectId, taskId),
      { projectId: projectId!, taskId: taskId! },
    );
    expect(actual.run).toBeUndefined();
    expect(actual.error).toContain('CONFLICT (content)');
    expect(actual.error).toContain('apps/backend/chatballs/conversations/models.py');
    await page
      .locator('.project-nav')
      .getByRole('button', { name: /^Задачи/ })
      .click();
    await page.locator('.board .card').filter({ hasText: actual.task.title }).click();
    await expect(page.locator('.task-conversation .banners')).toContainText(actual.error!);
    await expect(page.locator('.task-conversation .banners')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('actual-T055-dependency-error.png') });
    await page.reload();
    await page
      .locator('.project-nav')
      .getByRole('button', { name: /^Задачи/ })
      .click();
    await page.locator('.board .card').filter({ hasText: actual.task.title }).click();
    await expect(page.locator('.task-conversation .banners')).toContainText('CONFLICT (content)');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
