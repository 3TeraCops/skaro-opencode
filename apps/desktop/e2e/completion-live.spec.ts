import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

const profile = process.env['SKARO_E2E_LIVE_PROFILE'];
const projectId = process.env['SKARO_E2E_COMPLETION_PROJECT'];
test.skip(
  !profile || !projectId,
  'Requires an existing Skaro profile and project; creates no test data',
);

test('the real plan opens task chats and has no milestone chat action', async ({
  playwright: _playwright,
}, testInfo) => {
  const app = await launchApp(profile!);
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const previous = await page.evaluate(async () => {
    const api = (window as unknown as { skaro: SkaroApi }).skaro;
    return { tabs: await api.invoke('tabs.get'), locale: await api.invoke('app.getLocale') };
  });
  try {
    await page.evaluate(async (id) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      await api.invoke('app.setLocale', 'ru');
      await api.invoke('tabs.set', { projects: [id], active: id });
    }, projectId!);
    await page.reload();
    const data = await page.evaluate(async (id) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      return {
        tasks: await api.invoke('tasks.list', id),
        stages: await api.invoke('stages.list', id),
      };
    }, projectId!);
    const stage = data.stages.find((item) =>
      data.tasks.some((task) => task.milestone?.id === item.id && !task.archived),
    );
    if (!stage) throw new Error('The real project has no visible milestone to inspect');
    await page.getByRole('navigation').getByText('План', { exact: true }).click();
    const header = page.locator(`[data-stage-head="${stage.id}"]`);
    await expect(header).toBeVisible();
    await header.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    await expect(page.getByText('Открыть этап', { exact: true })).toHaveCount(0);
    const screenshot = testInfo.outputPath('plan.png');
    await page.screenshot({ path: screenshot });
    console.log(`Real Skaro plan: ${screenshot}`);
    await page.keyboard.press('Escape');
    const task = data.tasks.find((item) => item.milestone?.id === stage.id && !item.archived)!;
    await page.getByRole('navigation').getByText('Задачи', { exact: true }).click();
    await page.locator('.board .card').filter({ hasText: task.title }).click();
    await expect(page.locator('.task .fd-feed')).toBeVisible();
    const branch = page.locator('.task .branch');
    if (await branch.count()) await expect(branch).toHaveAttribute('data-tip', 'Ветка задачи');
    await page.screenshot({ path: testInfo.outputPath('task.png') });
    const after = await page.evaluate(async (id) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      return api.invoke('tasks.list', id);
    }, projectId!);
    expect(after.map((item) => [item.id, item.status])).toEqual(
      data.tasks.map((item) => [item.id, item.status]),
    );
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async ({ tabs, locale }) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      await api.invoke('tabs.set', tabs);
      await api.invoke('app.setLocale', locale);
    }, previous);
    await app.close();
  }
});
