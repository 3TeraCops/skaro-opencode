// Read an existing recorded task and its actual worktree; no generated history or API stand-in.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const task = process.env['SKARO_HISTORY_TASK'];
test.skip(
  !profile || !project || !task,
  'Requires an existing large task in the copied real profile',
);

test('pages a recorded task without transferring its complete native and integration histories', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  let app = await launchApp(profile!, { openSavedProject: false });
  let page = await app.firstWindow();
  let previous: { tabs: TabsState; workspace: WorkspaceState } | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    previous = await page.evaluate(
      async ({ project, task }) => {
        const tabs = await window.skaro.invoke('tabs.get');
        const workspace = (await window.skaro.invoke(
          'app.getSetting',
          'ui.workspace',
        )) as WorkspaceState;
        await window.skaro.invoke('tabs.set', {
          projects: tabs.projects.includes(project) ? tabs.projects : [...tabs.projects, project],
          active: project,
        });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          ...workspace,
          view: 'project',
          sections: { ...workspace.sections, [project]: 'tasks' },
          openTasks: { ...workspace.openTasks, [project]: task },
        });
        return { tabs, workspace };
      },
      { project: project!, task: task! },
    );
    await page.reload();
    const feed = page.locator('.task-conversation .fd-feed');
    await expect(feed).toBeVisible({ timeout: 90_000 });
    const view = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      { project: project!, task: task! },
    );
    expect(view.history).toBeDefined();
    expect(view.history!.itemCount).toBeGreaterThan(100);
    expect(view.timelineSources).toBeUndefined();
    expect(view.timeline!.items.length).toBeLessThan(80);
    expect(view.historyPage!.blocks.length).toBeLessThanOrEqual(32);
    const questions = view.timeline!.interactions.filter((item) => item.kind === 'question');
    // Read the owner's existing question only: never choose an option, answer it or start work.
    const pinned = async () => {
      const cards = page.locator('.task-conversation .questions .fd-card.question');
      await expect(cards).toHaveCount(questions.length);
      if (!questions.length) return undefined;
      await expect(cards.first().locator('.text')).toHaveText(questions[0]!.questions[0]!.text);
      expect(await cards.first().evaluate((el) => !!el.closest('.scroller'))).toBe(false);
      return cards.first().boundingBox();
    };
    const questionBounds = await pinned();
    const blocks = feed.locator(':scope > .virtual-blocks > [data-feed-block]');
    await expect(blocks.first()).toBeVisible();
    await expect.poll(() => blocks.count()).toBeLessThan(60);
    const scroller = page.locator('.task-conversation .feed-wrap > .scroller');
    await scroller.hover({ position: { x: 10, y: 20 } });
    await page.mouse.wheel(0, -1_000_000);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(3);
    await expect(blocks.first()).toBeVisible();
    const afterScroll = await pinned();
    if (questionBounds && afterScroll)
      expect(Math.abs(questionBounds.y - afterScroll.y)).toBeLessThan(1);
    await page.locator('.task-conversation .feed-wrap > .down').click();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(5);
    await page.screenshot({ path: info.outputPath('task-history-paged.png') });
    console.log('Real task history:', {
      items: view.history!.itemCount,
      headerItems: view.timeline!.items.length,
      mounted: await blocks.count(),
    });
    console.log('Existing owner questions available for read-only check:', questions.length);
    if (questions.length) {
      await app.close();
      app = await launchApp(profile!, { openSavedProject: false });
      page = await app.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      await pinned();
      const restored = await page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
        { project: project!, task: task! },
      );
      expect(restored.timeline!.interactions.filter((item) => item.kind === 'question')).toEqual(
        questions,
      );
      await page.screenshot({ path: info.outputPath('owner-question-restored.png') });
      console.log('Existing owner questions preserved without answering:', questions.length);
    }
    expect(errors).toEqual([]);
  } finally {
    if (previous)
      await page.evaluate(async ({ tabs, workspace }) => {
        await window.skaro.invoke('tabs.set', tabs);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', workspace);
      }, previous);
    await app.close();
  }
});
