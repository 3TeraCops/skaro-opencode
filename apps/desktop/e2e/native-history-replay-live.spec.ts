import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { feedRows } from '@skaro/timeline';
import { feedText } from '../src/shared/history-text';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const chat = process.env['SKARO_NATIVE_REPLAY_CHAT'];
test.skip(
  !profile || !project || !chat,
  'Requires an actual saved native history in the test project',
);

test('replays the actual native log and copies all recorded command output without another agent call', async ({
  browserName: _browserName,
}, info) => {
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(
      async ({ project, chat }) => {
        await window.skaro.invoke('tabs.set', { projects: [project], active: project });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'chat' },
          openChats: { [project]: chat },
          openTasks: {},
        });
      },
      { project: project!, chat: chat! },
    );
    await page.reload();
    await expect(page.locator('.sessions .row.on')).toBeInViewport();
    const index = await page.evaluate(
      async ({ project, chat }) => {
        const catalog = await window.skaro.invoke('chats.query', project, false);
        return (await window.skaro.invoke('chats.find', catalog.source, chat)).index;
      },
      { project: project!, chat: chat! },
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator('.sessions > .list').evaluate((element, index) => {
      element.scrollTop = index * 32;
    }, index);
    await page.locator(`.sessions .row[data-chat-id="${chat!}"]`).click();
    await expect(page.locator('.chat .fd-feed')).toBeVisible();
    const view = await page.evaluate(
      ({ project, chat }) => window.skaro.invoke('chat.open', project, chat),
      { project: project!, chat: chat! },
    );
    const outputs = view.timeline.items.flatMap((item) =>
      item.kind === 'command' ? [item.output] : [],
    );
    await expect(page.locator('.chat .fd-text .md').last()).toContainText(
      'Вывод агентов: реальность, модель, отображение',
    );
    await page.screenshot({ path: info.outputPath('actual-native-markdown.png') });
    expect(Math.max(...outputs.map((text) => text.length))).toBeGreaterThan(50_000);
    const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
    let log: string;
    try {
      const row = db
        .prepare('SELECT log_path FROM chats WHERE id=? AND project_id=?')
        .get(chat!, project!);
      if (!row) throw new Error('The actual native history is outside the test project');
      log = await readFile(join(profile!, String(row['log_path'])), 'utf8');
    } finally {
      db.close();
    }
    expect(log.trimEnd().split('\n').length).toBeGreaterThan(1000);
    const expected = feedText(feedRows(view.timeline));
    await page.locator('.chat .main > .head').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect
      .poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === expected)
      .toBe(true);
    console.log(
      'Actual native replay:',
      JSON.stringify({
        rawEvents: log.trimEnd().split('\n').length,
        canonicalItems: view.timeline.items.length,
        maxOutput: Math.max(...outputs.map((text) => text.length)),
        copied: expected.length,
      }),
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
