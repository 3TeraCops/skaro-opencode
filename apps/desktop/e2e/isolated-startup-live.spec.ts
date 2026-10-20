import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { restoredChatList } from './startup-chat-list-live';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires the separate real test project');

test('restores a deep saved chat and paints the indexed chat catalog after a full restart', async ({
  browserName: _browserName,
}, info) => {
  let app = await launchApp(profile!, { openSavedProject: false });
  try {
    let page = await app.firstWindow();
    await page.locator('.project-nav').getByRole('button', { name: 'Чат', exact: true }).click();
    await expect(page.locator('.sessions .row.on')).toBeInViewport();
    const selected = await page.evaluate(async (project) => {
      const chats = await window.skaro.invoke('chats.list', project);
      return chats.filter((chat) => !chat.archived).at(-1)!;
    }, project!);
    await page.locator('.sessions > .list').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.locator(`.sessions .row[data-chat-id="${selected.id}"]`).click();
    await expect(page.locator('.chat .main > .head .title')).toHaveText(selected.title);
    await expect
      .poll(() =>
        page.evaluate(async (project) => {
          const saved = (await window.skaro.invoke(
            'app.getSetting',
            'ui.workspace',
          )) as WorkspaceState;
          return { section: saved.sections[project], chat: saved.openChats[project] };
        }, project!),
      )
      .toEqual({ section: 'chat', chat: selected.id });
    await app.close();
    app = await launchApp(profile!, { openSavedProject: false });
    page = await app.firstWindow();
    await restoredChatList(app, page, project!);
    const row = page.locator(`.sessions .row[data-chat-id="${selected.id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/on/);
    await expect(page.locator('.chat .main > .head .title')).toHaveText(selected.title);
    const paint = await page.evaluate(() => ({
      firstContent: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      historyContent: performance.getEntriesByName('skaro.history.content').at(-1)?.startTime,
      origin: performance.timeOrigin,
    }));
    const created = await app.evaluate(
      ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Browser')!.creationTime,
    );
    console.log(
      'Separate project restart (ms):',
      JSON.stringify({
        firstContent:
          paint.firstContent === undefined ? null : paint.origin + paint.firstContent - created,
        historyContent:
          paint.historyContent === undefined ? null : paint.origin + paint.historyContent - created,
      }),
    );
    await page.screenshot({ path: info.outputPath('restored-test-project.png') });
  } finally {
    await app.close();
  }
});
