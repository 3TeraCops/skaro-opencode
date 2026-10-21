import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';

interface PreviewSample {
  id: string;
  height: number;
  cardHeight: number;
  dx: number;
  dy: number;
}
declare const window: Window & {
  skaro: SkaroApi;
  loadingSeen: string[];
  previewLoading: PreviewSample[];
};
const root = process.env['SKARO_UI_VERIFY_ROOT'];
const project = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const chat = '4567fe74-5d8a-4fe6-a3a0-40e1fa044518';
test.skip(!root, 'Requires an isolated copy of genuine saved projects and native histories');

async function navigate(page: Page, id: string, section: string, chatId?: string, taskId?: string) {
  await page.evaluate(
    async ({ id, section, chatId, taskId }) => {
      await window.skaro.invoke('tabs.set', { projects: [id], active: id });
      await window.skaro.invoke('app.setLocale', 'ru');
      const saved = (await window.skaro.invoke('app.getSetting', 'ui.workspace')) as WorkspaceState;
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...saved,
        view: 'project',
        sections: { [id]: section },
        openChats: { [id]: chatId },
        openTasks: { [id]: taskId },
      });
    },
    { id, section, chatId, taskId },
  );
  await page.reload();
}

async function fingerprint(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === '.git') continue;
      hash.update(entry.name);
      const next = join(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else hash.update(await readFile(next));
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

async function worktreeFingerprint(path: string): Promise<string> {
  const exists = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  // Completed tasks legitimately retain their run after the checkout has been removed.
  return exists ? fingerprint(path) : 'removed';
}

test('native navigation, document groups and clearing both conversations preserve project changes', async () => {
  test.setTimeout(240_000);
  const app = await launchApp(join(root!, 'profile'), { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await navigate(page, project, 'docs');
    const nav = page.locator('.project-nav');
    await expect(nav.locator('.item .label')).toHaveText([
      'Документы',
      'C4',
      'Граф связей',
      'План',
      'Задачи',
      'Чат',
      'Параметры',
      'Оставшийся лимит',
    ]);
    await expect(nav.locator('.item[data-tip]')).toHaveCount(0);
    await nav.locator('.toggle').click();
    await expect(nav.locator('.rail-item[data-tip]').first()).toHaveAttribute(
      'data-tip',
      'Документы',
    );
    await nav.locator('.expand').click();
    const groups = page.locator('[data-doc-tree].group');
    await expect(groups.first()).toBeVisible();
    await groups.first().click();
    const saved = await page.evaluate(() =>
      localStorage.getItem(`skaro.doc.groups.${'78bc2cd3-981b-40ed-a395-c6c6bc7da51b'}`),
    );
    await nav.getByRole('button', { name: /^План/ }).click();
    await nav.getByRole('button', { name: 'Документы', exact: true }).click();
    await expect(groups.first().locator('.chev')).not.toHaveClass(/open/);
    await page.reload();
    await expect(groups.first().locator('.chev')).not.toHaveClass(/open/);
    expect(
      await page.evaluate(() =>
        localStorage.getItem(`skaro.doc.groups.${'78bc2cd3-981b-40ed-a395-c6c6bc7da51b'}`),
      ),
    ).toBe(saved);
    await page.screenshot({ path: join(root!, 'documents.png') });

    await navigate(page, project, 'chat', chat);
    await expect(page.locator('.fd-feed')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.chat .bottom')).toHaveCSS('padding-bottom', '17px');
    await expect(page.locator('.effort-bars')).toHaveCount(0);
    const before = await fingerprint(join(root!, 'project'));
    const clear = page.getByRole('button', { name: 'Очистить историю чата', exact: true });
    await clear.click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.locator('.fd-feed')).toBeVisible();
    await clear.click();
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(page.locator('.fd-feed')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.chat .head')).toBeVisible();
    const empty = await page.evaluate(
      ({ project, chat }) => window.skaro.invoke('chat.open', project, chat, { paged: true }),
      { project, chat },
    );
    expect(empty.history?.count ?? empty.timeline.items.length).toBe(0);
    expect(await fingerprint(join(root!, 'project'))).toBe(before);
    await page.screenshot({ path: join(root!, 'chat-cleared.png') });

    await navigate(page, project, 'tasks', undefined, 'T-003');
    await expect(page.locator('.task-conversation .fd-feed')).toBeVisible({ timeout: 60_000 });
    const taskBefore = await page.evaluate(
      (id) => window.skaro.invoke('task.open', id, 'T-003', { paged: true }),
      project,
    );
    const hashes = await Promise.all([
      fingerprint(join(root!, 'project')),
      worktreeFingerprint(taskBefore.run!.worktree!),
    ]);
    await page.screenshot({ path: join(root!, 'task-before.png') });
    await expect(page.locator('.task-conversation > .tools')).toHaveCount(0);
    await expect(page.locator('.task-conversation > button.floating')).toBeVisible();
    await page.getByRole('button', { name: 'Свернуть описание', exact: true }).click();
    await expect(
      page
        .locator('.task-conversation > .head')
        .getByRole('button', { name: 'Очистить историю чата', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(root!, 'task-header-collapsed.png') });
    await page.getByRole('button', { name: 'Очистить историю чата', exact: true }).click();
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(page.locator('.task-conversation .fd-feed')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.task-conversation')).toBeVisible();
    const taskAfter = await page.evaluate(
      (id) => window.skaro.invoke('task.open', id, 'T-003', { paged: true }),
      project,
    );
    expect(taskAfter.history?.count ?? taskAfter.timeline?.items.length).toBe(0);
    expect(taskAfter.task).toEqual(taskBefore.task);
    expect(taskAfter.run?.id).toBe(taskBefore.run?.id);
    expect(taskAfter.run?.worktree).toBe(taskBefore.run?.worktree);
    expect(
      await Promise.all([
        fingerprint(join(root!, 'project')),
        worktreeFingerprint(taskAfter.run!.worktree!),
      ]),
    ).toEqual(hashes);
    await page.screenshot({ path: join(root!, 'task-cleared.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('native C4 previews and graph construction stay visible while loading', async () => {
  test.setTimeout(240_000);
  const app = await launchApp(join(root!, 'graph-profile'), { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      window.loadingSeen = [];
      window.previewLoading = [];
      new MutationObserver(() => {
        for (const selector of [
          '.preview-body .loading-indicator',
          '.graph-workspace .loading-indicator',
        ]) {
          const element = document.querySelector(selector);
          if (
            element &&
            element.getBoundingClientRect().height > 0 &&
            !window.loadingSeen.includes(selector)
          )
            window.loadingSeen.push(selector);
        }
        for (const spinner of document.querySelectorAll('.preview-body .loading-indicator')) {
          const card = spinner.closest('[data-c4-preview]')!;
          const id = card.getAttribute('data-c4-preview')!;
          if (window.previewLoading.some((sample) => sample.id === id)) continue;
          const body = spinner.parentElement!.getBoundingClientRect();
          const indicator = spinner.getBoundingClientRect();
          if (!body.height || !indicator.height) continue;
          window.previewLoading.push({
            id,
            height: body.height,
            cardHeight: card.getBoundingClientRect().height,
            dx: indicator.x + indicator.width / 2 - body.x - body.width / 2,
            dy: indicator.y + indicator.height / 2 - body.y - body.height / 2,
          });
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const added = await page.evaluate(
      (path) => window.skaro.invoke('projects.add', path),
      join(root!, 'c4-project'),
    );
    await navigate(page, added.id, 'c4');
    await expect(page.locator('.c4-preview-svg').first()).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => window.loadingSeen)).toContain(
      '.preview-body .loading-indicator',
    );
    await expect(page.locator('.preview-body').first()).toHaveCSS('height', '180px');
    await expect(page.locator('[data-c4-preview]').first()).toHaveCSS('min-height', '264px');
    const firstCard = page.locator('[data-c4-preview]').first();
    const firstId = await firstCard.getAttribute('data-c4-preview');
    const sample = await page.evaluate(
      (id) => window.previewLoading.find((entry) => entry.id === id),
      firstId,
    );
    expect(sample?.height).toBe(180);
    expect(Math.abs(sample!.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(sample!.dy)).toBeLessThanOrEqual(1);
    expect(sample!.cardHeight).toBeCloseTo((await firstCard.boundingBox())!.height, 0);
    await expect(
      page.locator('.preview-footer').filter({ hasText: 'Открыть диаграмму' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    const list = page.locator('[data-c4-list]');
    await expect(list).toBeVisible();
    await expect(page.locator('[data-c4-preview]')).toHaveCount(0);
    await expect(list.locator('.loading-indicator, svg')).toHaveCount(0);
    expect((await list.locator('button').first().boundingBox())!.height).toBeLessThanOrEqual(44);
    const navigation = page
      .locator('.project-nav')
      .getByRole('button', { name: 'C4', exact: true });
    await list.locator('button').first().click();
    await expect(page.locator('[data-c4-element]').first()).toBeVisible();
    await expect(page.locator('.c4-canvas .loading-indicator')).toHaveCount(0);
    await navigation.click();
    await expect(list).toBeVisible();
    await expect(page.locator('.c4-viewer')).toHaveCount(0);
    await page.screenshot({ path: join(root!, 'c4-list.png') });
    await page.getByRole('button', { name: 'Плитка', exact: true }).click();
    await expect(list).toHaveCount(0);
    await expect(page.locator('[data-c4-preview]').first()).toBeVisible();
    await page.locator('[data-c4-preview]').first().getByRole('button').click();
    await expect(page.locator('[data-c4-element]').first()).toBeVisible();
    await navigation.click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible();
    await expect(page.locator('.c4-viewer')).toHaveCount(0);
    await page.screenshot({ path: join(root!, 'c4-gallery.png') });
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Граф связей', exact: true })
      .click();
    await expect(page.locator('.sigma-host[data-layout-ready="true"]')).toBeVisible({
      timeout: 180_000,
    });
    expect(await page.evaluate(() => window.loadingSeen)).toContain(
      '.graph-workspace .loading-indicator',
    );
    await expect(page.locator('.graph-building')).toHaveCount(0);
    await page.screenshot({ path: join(root!, 'graph.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
