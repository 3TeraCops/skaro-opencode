// Real tasks from a copied project with multiple milestones; cancelled drags write no artifacts.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_LAUNCH_PROJECT'];
test.skip(!profile || !project, 'Requires an isolated real project with several task groups');

test('moves a task slot across real milestone boundaries and cancels pointer and keyboard drags', async () => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const saved = await page.evaluate(async (project) => {
    const tabs = await window.skaro.invoke('tabs.get');
    const workspace = (await window.skaro.invoke(
      'app.getSetting',
      'ui.workspace',
    )) as WorkspaceState;
    await window.skaro.invoke('tabs.set', {
      projects: [...new Set([...tabs.projects, project])],
      active: project,
    });
    await window.skaro.invoke('app.setSetting', 'ui.workspace', {
      ...workspace,
      view: 'project',
      sections: { ...workspace.sections, [project]: 'plan' },
    });
    return { tabs, workspace };
  }, project!);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.reload();
    const catalog = await page.evaluate(
      (project) => window.skaro.invoke('plan.catalog', project),
      project!,
    );
    expect(catalog.plan.length).toBeGreaterThan(1);
    const index = catalog.plan.findIndex(
      (stage, index) => stage.taskCount && catalog.plan[index + 1],
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const source = catalog.plan[index]!,
      target = catalog.plan[index + 1]!;
    const query = await page.evaluate(
      ({ project, milestone }) =>
        window.skaro.invoke('tasks.query', project, { kind: 'plan', milestones: [milestone] }),
      { project: project!, milestone: source.milestone.id },
    );
    const rows = await page.evaluate(
      ({ query, start }) => window.skaro.invoke('tasks.page', query, start),
      { query, start: source.taskCount - 1 },
    );
    const id = rows[0]!.id;
    const scroller = page.locator('.stages[data-plan-screen]');
    await expect(scroller.locator('[data-stage-head]').first()).toBeVisible();
    const expand = page.locator('.tools[data-plan-screen] button[data-tip="Развернуть все этапы"]');
    if (!(await expand.count()))
      await page.locator('.tools[data-plan-screen] button[data-tip="Свернуть все этапы"]').click();
    await expand.click();
    const row = scroller.locator(`[data-row="${id}"]`);
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    const destination = scroller.locator(`[data-drop="${target.milestone.id}"]`);
    await expect(destination.locator('[data-rows] .slot')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
    await expect(scroller.locator('.slot')).toHaveCount(0);
    const origin = await row.boundingBox(),
      to = await destination.locator('.head').boundingBox();
    expect(origin).toBeTruthy();
    expect(to).toBeTruthy();
    await page.mouse.move(origin!.x + 15, origin!.y + 15);
    await page.mouse.down();
    await page.mouse.move(to!.x + 80, to!.y + 12, { steps: 8 });
    await expect(destination.locator('[data-rows] .slot')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(row).toBeVisible();
    await expect(scroller.locator('.slot')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async ({ tabs, workspace }) => {
      await window.skaro.invoke('tabs.set', tabs);
      await window.skaro.invoke('app.setSetting', 'ui.workspace', workspace);
    }, saved);
    await app.close();
  }
});
