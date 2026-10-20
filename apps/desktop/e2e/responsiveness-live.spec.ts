// Run only against an isolated copy of an existing real profile and its real Git checkouts.
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import { browserTrace } from './browser-trace';
import { restoredChatList } from './startup-chat-list-live';
import type { SkaroApi } from '../src/shared/ipc';
declare const window: Window & {
  skaro: SkaroApi;
  responsiveness: { long: number[]; gaps: number[] };
};

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const historicalChat = process.env['SKARO_RESPONSIVENESS_CHAT'];
test.skip(!profile || !projectId, 'Requires an isolated copy of a real Skaro profile');

test('real large project stays responsive while loading history and restores the last workspace', async ({
  browserName: _browserName,
}, info) => {
  test.skip(!historicalChat, 'Requires the actual historical C4 conversation');
  test.setTimeout(240_000);
  let app = await launchApp(profile!, { openSavedProject: false });
  const errors: string[] = [];
  app
    .process()
    .stdout?.on('data', (data: Buffer) => process.stdout.write(`[main] ${String(data)}`));
  app
    .process()
    .stderr?.on('data', (data: Buffer) => process.stdout.write(`[main error] ${String(data)}`));
  try {
    let page = await app.firstWindow();
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('Renderer error:', error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('Renderer console:', message.text());
    });
    await expect(page.locator('.project-nav'))
      .toBeVisible({ timeout: 30_000 })
      .catch(async (error: unknown) => {
        console.log('Initial DOM:', (await page.locator('body').innerHTML()).slice(0, 4000));
        console.log('Recorded errors:', errors);
        await page.screenshot({ path: info.outputPath('startup-failure.png') });
        throw error;
      });
    await page.evaluate(() => {
      window.responsiveness = { long: [], gaps: [] };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.responsiveness.long.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
      let at = performance.now();
      setInterval(() => {
        const now = performance.now();
        window.responsiveness.gaps.push(now - at);
        at = now;
      }, 10);
    });
    const profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    const stopTrace = await browserTrace(profiler, info.outputPath('history.trace.json'));
    await profiler.send('Profiler.start');
    const project = (await page.evaluate(() => window.skaro.invoke('projects.list'))).find(
      (p) => p.id === projectId,
    )!;
    expect(project).toBeDefined();
    const chats = await page.evaluate((id) => window.skaro.invoke('chats.list', id), projectId!);
    expect(chats.length).toBeGreaterThan(0);
    // The actual historical C4 conversation contains the largest package in this real profile.
    const chat = chats.find((c) => c.id === historicalChat);
    expect(chat).toBeDefined();
    if (!chat) throw new Error('The actual historical C4 conversation is missing');
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, projectId!, chat.id)).click();
    await expect(page.locator('.chat .fd-feed')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.chat .fd-feed .virtual-block').first()).toBeVisible();
    await expect(page.locator('.chat .main > .head .title')).toHaveText(chat.title);
    const canonical = await page.evaluate(
      async ({ project, chat }) => {
        const view = await window.skaro.invoke('chat.open', project, chat, { paged: true });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return {
          items: view.history?.itemCount,
          headerItems: view.timeline.items.length,
          seq: view.seq,
        };
      },
      { project: projectId!, chat: chat.id },
    );
    console.log('Canonical history:', canonical);
    const first = await page.evaluate(() => ({
      metrics: window.responsiveness,
      rows: document.querySelectorAll('.chat .fd-feed [data-feed-block]').length,
      nodes: document.querySelectorAll('*').length,
      workspace: window.skaro.invoke('app.getSetting', 'ui.workspace'),
    }));
    const { profile: cpu } = await profiler.send('Profiler.stop');
    await stopTrace?.();
    await writeFile(info.outputPath('history.cpuprofile'), JSON.stringify(cpu));
    console.log(
      'Real history metrics:',
      JSON.stringify({
        rows: first.rows,
        nodes: first.nodes,
        longTasks: first.metrics.long,
        maxGap: Math.max(...first.metrics.gaps),
      }),
    );
    expect(first.rows).toBeLessThan(100);
    await page.screenshot({ path: info.outputPath('real-history.png') });
    // Native wheel input must reach the history without waiting for the rest of the project.
    const scroller = page.locator('.chat .feed-wrap > .scroller');
    await scroller.hover();
    await page.mouse.wheel(0, -1500);
    await expect(page.locator('.chat .feed-wrap > .down')).toBeVisible();
    await page.locator('.chat .feed-wrap > .down').click();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(5);
    await page
      .locator('.proposal')
      .last()
      .getByRole('button', { name: 'Открыть', exact: true })
      .click();
    const viewer = page.getByRole('dialog').locator('.viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.md').first()).toBeVisible({ timeout: 30_000 });
    const filesShown = await viewer.locator(':scope > .virtual-blocks > .virtual-block').count();
    expect(filesShown).toBeLessThan(5);
    await page.screenshot({ path: info.outputPath('package-viewer.png') });
    console.log('Package viewport file count:', filesShown);
    const paths = await page.evaluate(
      async ({ project, chat }) => {
        const view = await window.skaro.invoke('chat.open', project, chat, { paged: true });
        const changes = await window.skaro.invoke('history.changes', view.history!, 0);
        const item = changes.findLast((item) => item.proposal.type === 'architecture');
        if (!item) throw new Error('The real C4 package is missing');
        return window.skaro.invoke('c4.files', project, item.itemId);
      },
      { project: projectId!, chat: chat.id },
    );
    await viewer.locator('.md').first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect
      .poll(
        () =>
          app.evaluate(async ({ clipboard }, paths) => {
            const text = await clipboard.readText();
            return paths.every((path) => text.includes(`.skaro/${path}`));
          }, paths),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => {
        const saved = (await page.evaluate(() =>
          window.skaro.invoke('app.getSetting', 'ui.workspace'),
        )) as { openChats?: Record<string, string> };
        return saved.openChats?.[projectId!];
      })
      .toBe(chat.id);
    await app.close();
    app = await launchApp(profile!, { openSavedProject: false });
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await restoredChatList(app, page, projectId!);
    await expect(page.locator('.chat .main > .head')).toContainText(chat.title, {
      timeout: 15_000,
    });
    await expect(page.locator('.chat .fd-feed')).toBeVisible();
    await page.screenshot({ path: info.outputPath('restored-history.png') });
    console.log(
      'Restored paint:',
      JSON.stringify(
        await page.evaluate(() =>
          performance.getEntriesByType('paint').map((e) => ({ name: e.name, at: e.startTime })),
        ),
      ),
    );
    const createdAt = await app.evaluate(
      ({ app }) => app.getAppMetrics().find((metric) => metric.pid === process.pid)!.creationTime,
    );
    const paintedAt = await page.evaluate(
      () =>
        performance.timeOrigin +
        performance.getEntriesByName('first-contentful-paint')[0]!.startTime,
    );
    console.log('Restored first content from OS process creation (ms):', paintedAt - createdAt);
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('skaro.history.content').length))
      .toBeGreaterThan(0);
    const historyAt = await page.evaluate(
      () =>
        performance.timeOrigin +
        performance.getEntriesByName('skaro.history.content').at(-1)!.startTime,
    );
    console.log('Restored actual history from OS process creation (ms):', historyAt - createdAt);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('acknowledges a real owner message before native startup and reconciles its echo', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    // Native keyboard/capture checks require the real test window to remain drawable on Windows.
    console.log(
      'Owner interaction native window:',
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const previous = {
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused(),
        };
        window.webContents.setBackgroundThrottling(false);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return previous;
      }),
    );
    await page.locator('.sessions > .new').click();
    const input = page.locator('.chat .composer textarea');
    const marker = `SKARO_ACK_${Date.now()}`;
    const text = `Проверка доставки сообщения. Ответь только ${marker}. Не используй инструменты, не читай и не изменяй файлы или документы проекта.`;
    await expect(input).toBeEnabled();
    await input.fill(text);
    await input.evaluate((el, text) => {
      let start = 0;
      el.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') start = performance.now();
      });
      const observer = new MutationObserver(() => {
        if (
          !start ||
          ![...document.querySelectorAll('.fd-bubble')].some((bubble) =>
            bubble.textContent?.includes(text),
          )
        )
          return;
        requestAnimationFrame(
          () => (document.body.dataset['echoLatency'] = String(performance.now() - start)),
        );
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, text);
    await input.press('Enter');
    await expect(page.locator('.fd-bubble').filter({ hasText: text })).toBeVisible();
    await expect(page.locator('.fd-live')).toBeVisible();
    const latency = await page.locator('body').getAttribute('data-echo-latency');
    console.log('Owner echo latency (ms):', latency);
    expect(latency).not.toBeNull();
    expect(Number(latency)).toBeLessThan(150);
    await expect(page.locator('.fd-text').filter({ hasText: marker })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('.fd-bubble').filter({ hasText: text })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('owner-echo.png') });
    // Copying addresses the model consistently even when the outer feed is short.
    await page.locator('.chat .main > .head').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    await expect
      .poll(async () =>
        (await app.evaluate(({ clipboard }) => clipboard.readText())).startsWith(text),
      )
      .toBe(true);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied.startsWith(text)).toBe(true);
    expect(copied).toContain(marker);
  } finally {
    await app.close();
  }
});
