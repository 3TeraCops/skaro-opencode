import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

/** Inspect real preload data and real visible rows; never delay or replace backend replies. */
export async function restoredChatList(app: ElectronApplication, page: Page, project: string) {
  const catalog = await page.evaluate(async () => (await window.skaro.bootstrapReady)?.chatCatalog);
  expect(catalog?.source.projectId).toBe(project);
  expect(catalog?.source.archived).toBe(false);
  expect(catalog?.start).toBe(0);
  expect(catalog!.chats.length).toBe(Math.min(32, catalog!.source.count));
  const rows = page.locator('.sessions .row[data-chat-id]');
  await expect(rows.first()).toBeVisible();
  const visibleAt = await page.evaluate(() => performance.timeOrigin + performance.now());
  const createdAt = await app.evaluate(
    ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Browser')!.creationTime,
  );
  const current = await page.evaluate(
    (project) => window.skaro.invoke('chats.query', project, false),
    project,
  );
  expect(catalog!.chats.slice(0, 16)).toEqual(current.chats);
  expect(catalog!.source).toEqual(current.source);
  console.log(
    'Restored indexed chat list:',
    JSON.stringify({
      preloadRows: catalog!.chats.length,
      total: catalog!.source.count,
      mounted: await rows.count(),
      visibleFromProcessMs: visibleAt - createdAt,
    }),
  );
}
