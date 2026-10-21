// Observe the genuine Electron/preload/backend on existing recorded data; no response overrides.
import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';

interface LoadingSample {
  scope: string;
  animation: string;
  width: number;
  height: number;
  at: number;
}
declare const window: Window & { skaro: SkaroApi; loadingSamples: LoadingSample[] };

async function observeLoading(page: Page) {
  await page.addInitScript(() => {
    window.loadingSamples = [];
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('.loading-indicator')) {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const scope = element.closest('.task-conversation')
          ? 'task'
          : element.closest('.chat .main')
            ? 'chat'
            : element.closest('.sessions')
              ? 'catalog'
              : 'screen';
        if (window.loadingSamples.some((sample) => sample.scope === scope)) continue;
        window.loadingSamples.push({
          scope,
          animation: getComputedStyle(element).animationName,
          width: rect.width,
          height: rect.height,
          at: performance.now(),
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function navigate(
  page: Page,
  project: string,
  section: string,
  chat?: string,
  task?: string,
) {
  await page.evaluate(
    async ({ project, section, chat, task }) => {
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      await window.skaro.invoke('tabs.set', { projects: [project], active: project });
      await window.skaro.invoke('app.setLocale', 'ru');
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: section },
        openChats: { ...workspace.openChats, [project]: chat },
        openTasks: { ...workspace.openTasks, [project]: task },
      });
    },
    { project, section, chat, task },
  );
  await page.reload();
}

test('shows loading during real chat opening and keeps the wider catalog inset from its scrollbar', async ({
  browserName: _browserName,
}, info) => {
  const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
  const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
  const chat = process.env['SKARO_RESPONSIVENESS_CHAT'];
  test.skip(!profile || !project || !chat, 'Requires an isolated real recorded chat');
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await observeLoading(page);
    await navigate(page, project!, 'chat', 'new');
    const sidebar = page.locator('.sessions');
    await expect(sidebar).toBeVisible();
    const geometry = await sidebar.evaluate((element) => {
      const list = element.querySelector('.list')!;
      const panelCss = getComputedStyle(element);
      return {
        width: panelCss.width,
        panelPadding: panelCss.paddingRight,
        listPadding: getComputedStyle(list).paddingRight,
        scrollable: list.scrollHeight > list.clientHeight,
      };
    });
    expect(geometry).toEqual({
      width: '248px',
      panelPadding: '14px',
      listPadding: '6px',
      scrollable: true,
    });
    const before = await page.evaluate(() => performance.now());
    await (await revealChatRow(page, project!, chat!)).click();
    await expect(page.locator('.chat .fd-feed [data-feed-block]').first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('.chat .main > .loading')).toHaveCount(0);
    const samples = await page.evaluate(() => window.loadingSamples);
    expect(samples.some((sample) => sample.scope === 'chat')).toBe(true);
    expect(samples.every((sample) => sample.animation !== 'none' && sample.width >= 16)).toBe(true);
    await expect(page.locator('.chat .fd-feed .loading-indicator')).toHaveCount(0, {
      timeout: 60_000,
    });
    const elapsed = (await page.evaluate(() => performance.now())) - before;
    await page.screenshot({ path: info.outputPath('chat-loaded.png') });
    console.log('Real chat loading:', { samples, elapsed, geometry });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('adapts the real C4 gallery to one or two columns and shows initial task loading', async ({
  browserName: _browserName,
}, info) => {
  const profile = process.env['SKARO_UI_C4_PROFILE'];
  test.skip(!profile, 'Requires an existing native C4 verification profile');
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await observeLoading(page);
    const [project] = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(project).toBeDefined();
    await navigate(page, project!.id, 'c4');
    const gallery = page.locator('[data-c4-gallery]');
    const cards = gallery.locator('[data-c4-preview]');
    await expect(cards.nth(1)).toBeVisible({ timeout: 60_000 });
    for (const width of [1500, 1050]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 900),
        width,
      );
      const wide = width === 1500;
      await expect
        .poll(async () => {
          const [first, second] = await Promise.all([
            cards.nth(0).boundingBox(),
            cards.nth(1).boundingBox(),
          ]);
          return Math.abs(first!.y - second!.y) < 1;
        })
        .toBe(wide);
      await expect(cards.first().locator('.c4-preview-svg')).toBeVisible({ timeout: 30_000 });
      await expect(cards.nth(1).locator('.c4-preview-svg')).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: info.outputPath(`c4-${width}.png`) });
    }
    // Cached tasks paint real content immediately. Choose an uncached recorded task
    // to observe actual initial loading, leaving the existing cache untouched.
    const registry = new DatabaseSync(join(profile!, 'registry.db'), { readOnly: true });
    const cached = new Set(
      registry.prepare("SELECT 1 FROM sqlite_master WHERE name='shell_sessions'").get()
        ? registry
            .prepare('SELECT key FROM shell_sessions')
            .all()
            .map((row) => String(row['key']))
        : [],
    );
    registry.close();
    const tasks = await page.evaluate((id) => window.skaro.invoke('tasks.list', id), project!.id);
    const task = tasks.find(
      (task) => task.stage === 'done' && !cached.has(`task.${project!.id}.${task.id}`),
    );
    expect(task).toBeDefined();
    await navigate(page, project!.id, 'tasks', undefined, task!.id);
    await expect(page.locator('.task-conversation .bottom')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.task-conversation > .loading')).toHaveCount(0);
    const samples = await page.evaluate(() => window.loadingSamples);
    expect(samples.some((sample) => sample.scope === 'task')).toBe(true);
    console.log('Real task loading:', { task: task!.id, samples });
    await page.screenshot({ path: info.outputPath('task-loaded.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
