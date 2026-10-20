import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { launchApp } from './launch';
import { browserTrace } from './browser-trace';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & {
  skaro: SkaroApi;
  markdownMetrics: { long: number[]; gaps: number[] };
};
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const chatId = process.env['SKARO_HEAVY_MARKDOWN_CHAT'];
test.skip(
  !profile || !project || !chatId,
  'Requires a completed actual large Markdown answer in the separate test project',
);

test('profiles a real large Markdown answer and preserves its DOM and complete copying', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(300_000);
  let app = await launchApp(profile!, { openSavedProject: false });
  try {
    let page = await app.firstWindow();
    const chat = { id: chatId! };
    console.log('Replaying actual heavy answer chat:', chat.id);
    const view = await page.evaluate(
      ({ project, chat }) => window.skaro.invoke('chat.open', project, chat),
      { project: project!, chat: chat.id },
    );
    const answer = view.timeline.items
      .flatMap((item) => (item.kind === 'message' && item.role === 'agent' ? [item.text] : []))
      .sort((a, b) => b.length - a.length)[0]!;
    expect(answer.length).toBeGreaterThan(30_000);
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
      { project: project!, chat: chat.id },
    );
    await app.close();
    app = await launchApp(profile!, { openSavedProject: false });
    page = await app.firstWindow();
    await expect(page.locator('.chat .fd-text .md').last()).toBeVisible();
    const session = await page.context().newCDPSession(page);
    await page.addInitScript(() => {
      window.markdownMetrics = { long: [], gaps: [] };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.markdownMetrics.long.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
      let previous = performance.now();
      setInterval(() => {
        const now = performance.now();
        window.markdownMetrics.gaps.push(now - previous);
        previous = now;
      }, 10);
    });
    await session.send('Profiler.enable');
    const stopTrace = await browserTrace(session, info.outputPath('markdown.trace.json'));
    await session.send('Profiler.start');
    await page.reload();
    const markdown = page.locator('.chat .fd-text .md').last();
    await expect(markdown).toContainText('9.4', { timeout: 30_000 });
    const html = await markdown.innerHTML();
    const { profile: cpu } = await session.send('Profiler.stop');
    await stopTrace?.();
    await writeFile(info.outputPath('markdown.cpuprofile'), JSON.stringify(cpu));
    await writeFile(info.outputPath('rendered.html'), html);
    await writeFile(info.outputPath('answer.md'), answer);
    const metrics = await page.evaluate(() => window.markdownMetrics);
    console.log(
      'Actual large Markdown:',
      JSON.stringify({
        chat: chat.id,
        characters: answer.length,
        nodes: await markdown.locator('*').count(),
        longTasks: metrics.long,
        maxGap: Math.max(...metrics.gaps),
      }),
    );
    await markdown.locator('p').first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain(answer);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.screenshot({ path: info.outputPath('actual-heavy-markdown.png') });
  } finally {
    await app.close();
  }
});
