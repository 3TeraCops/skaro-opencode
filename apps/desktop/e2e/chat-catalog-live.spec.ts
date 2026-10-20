// Existing actual chats only: canonical metadata, real SQLite, Electron and native archive actions.
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { launchApp } from './launch';
import { chatListGeometry, collectChatRows } from './chat-list-live-support';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const baseline = process.env['SKARO_CHAT_BASELINE'];
const recording = process.env['SKARO_CHAT_RECORD_BASELINE'] === '1';
test.skip(!profile || !project, 'Requires the isolated existing real profile');

test('pages the complete real chat catalog and preserves rows, archive, focus and the saved selection', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  const duplicates: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().startsWith('Duplicate chat rows:')) duplicates.push(message.text());
  });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const ids = [...document.querySelectorAll<HTMLElement>('.sessions .list [data-chat-id]')].map(
        (row) => row.dataset['chatId']!,
      );
      const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (repeated.length) console.warn('Duplicate chat rows:', JSON.stringify(repeated));
    }).observe(document, { childList: true, subtree: true });
  });
  let saved: { tabs: TabsState; workspace: WorkspaceState } | undefined;
  let archived: string | undefined;
  try {
    saved = await page.evaluate(async (project) => {
      const tabs = await window.skaro.invoke('tabs.get');
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      const chats = await window.skaro.invoke('chats.list', project);
      const selected = chats.find((chat) => !chat.archived)!;
      await window.skaro.invoke('tabs.set', {
        projects: [...new Set([...tabs.projects, project])],
        active: project,
      });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: 'chat' },
        openChats: { ...workspace.openChats, [project]: selected.id },
      });
      return { tabs, workspace };
    }, project!);
    await page.reload();
    const list = page.locator('.sessions > .list');
    const rows = list.locator('[data-chat-id]');
    await expect(rows.first()).toBeVisible();
    const first = rows.first();
    await expect(first).toHaveClass(/on/);
    const geometry = await chatListGeometry(first);
    await page.screenshot({
      path: info.outputPath(recording ? 'chat-list-baseline.png' : 'chat-list-paged.png'),
    });
    if (recording) {
      if (!baseline) throw new Error('A baseline output path is required');
      await writeFile(baseline, JSON.stringify(geometry, null, 2));
      console.log('Actual baseline row:', geometry);
      return;
    }
    if (baseline) expect(geometry).toEqual(JSON.parse(await readFile(baseline, 'utf8')));
    const actual = await page.evaluate(
      (project) => window.skaro.invoke('chats.list', project),
      project!,
    );
    const source = await page.evaluate(
      (project) => window.skaro.invoke('chats.query', project, false),
      project!,
    );
    const live = actual.filter((chat) => !chat.archived);
    const past = actual.filter((chat) => chat.archived);
    expect(live.length).toBeGreaterThan(32);
    expect(source.activeCount).toBe(live.length);
    expect(source.archivedCount).toBe(past.length);
    expect(source.latest).toBe(live[0]!.id);
    for (const archived of [false, true]) {
      const catalog = await page.evaluate(
        ({ project, archived }) => window.skaro.invoke('chats.query', project, archived),
        { project: project!, archived },
      );
      const expected = actual.filter((chat) => chat.archived === archived);
      expect(catalog.source.count).toBe(expected.length);
      const records = [];
      for (let at = 0; at < catalog.source.count; at += 16) {
        const result = await page.evaluate(
          ({ source, at }) => window.skaro.invoke('chats.page', source, at),
          { source: catalog.source, at },
        );
        expect(result.chats.length).toBeLessThanOrEqual(16);
        records.push(...result.chats);
      }
      expect(records).toEqual(expected);
      if (expected.length) {
        const id = expected.at(-1)!.id;
        const found = await page.evaluate(
          ({ source, id }) => window.skaro.invoke('chats.find', source, id),
          { source: catalog.source, id },
        );
        expect(found.index).toBe(expected.length - 1);
      }
    }
    await first.focus();
    // Exercise the native Tab boundary as rows are mounted on demand.
    for (let index = 1; index < Math.min(live.length, 50); index++) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`[data-chat-id="${live[index]!.id}"]`)).toBeFocused();
    }
    const focused = await page.evaluate(
      () => (document.activeElement as HTMLElement)?.dataset['chatId'],
    );
    expect(focused).toBeTruthy();
    // A real no-op restore updates the chat's activity and publishes the normal sorted refresh.
    await page.evaluate(
      ({ project, focused }) => window.skaro.invoke('chat.archive', project, focused, false),
      { project: project!, focused: focused! },
    );
    await expect(list.locator(`[data-chat-id="${focused}"]`)).toBeFocused();
    await expect(rows.first()).toHaveAttribute('data-chat-id', focused!);
    const seen = await collectChatRows(list);
    expect([...seen].sort()).toEqual(live.map((chat) => chat.id).sort());
    expect(await rows.count()).toBeLessThan(live.length);
    await page.screenshot({ path: info.outputPath('chat-list-end.png') });
    const last = rows.last();
    const id = await last.getAttribute('data-chat-id');
    await last.focus();
    await page.keyboard.press('Enter');
    await expect(last).toHaveClass(/on/);
    await expect(page.locator('.chat .main > .head .title')).toHaveText(
      live.find((chat) => chat.id === id)!.title,
    );
    await page.reload();
    await expect(list.locator(`[data-chat-id="${id}"]`)).toBeInViewport();
    await expect(list.locator(`[data-chat-id="${id}"]`)).toHaveClass(/on/);
    // Archive only a genuine read-only validation chat, never an owner's conversation.
    const archiveTarget = live.find((chat) =>
      chat.title.startsWith('Проверка доставки сообщения.'),
    )?.id;
    expect(archiveTarget).toBeTruthy();
    await page.evaluate(
      ({ project, selected }) =>
        window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'chat' },
          openChats: { [project]: selected },
          openTasks: {},
        }),
      { project: project!, selected: archiveTarget! },
    );
    await page.reload();
    archived = archiveTarget!;
    await page.locator('.chat .main > .head button[aria-label="Архивировать чат"]').click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (project) => window.skaro.invoke('chats.query', project, true),
              project!,
            )
          ).source.count,
      )
      .toBe(past.length + 1);
    await page.locator('.sessions .archive-toggle').click();
    const restoredRow = list.locator(`[data-chat-id="${archived}"]`);
    await expect(restoredRow).toBeVisible();
    await page.screenshot({ path: info.outputPath('chat-list-archive.png') });
    await restoredRow.getByRole('button').click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (project) => window.skaro.invoke('chats.query', project, true),
              project!,
            )
          ).source.count,
      )
      .toBe(past.length);
    archived = undefined;
    await page.locator('.sessions .archive-toggle').click();
    await expect(list.locator(`[data-chat-id="${archiveTarget}"]`)).toBeVisible();
    const final = await page.evaluate(
      (project) => window.skaro.invoke('chats.query', project, false),
      project!,
    );
    expect(final.activeCount).toBe(live.length);
    expect(final.archivedCount).toBe(past.length);
    const refreshed = await page.evaluate(
      (source) => window.skaro.invoke('chats.page', source, 0),
      source.source,
    );
    expect(refreshed.source.revision).toBeGreaterThan(source.source.revision);
    expect(duplicates).toEqual([]);
    expect(errors).toEqual([]);
    console.log('Actual paged chats:', {
      total: live.length + past.length,
      mounted: await rows.count(),
      geometry,
    });
  } finally {
    if (archived)
      await page.evaluate(
        ({ project, chat }) => window.skaro.invoke('chat.archive', project, chat, false),
        { project: project!, chat: archived },
      );
    if (saved)
      await page.evaluate(async ({ tabs, workspace }) => {
        await window.skaro.invoke('tabs.set', tabs);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', workspace);
      }, saved);
    await app.close();
  }
});
