// Only recorded file edits from the real copied profile; no generated diff or replaced bridge.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import { numberedDiffLines } from '../src/renderer/src/feed/diff-model';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi; diffLongTasks: number[] };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const chat = process.env['SKARO_VIRTUAL_CHAT'];
const baseline = process.env['SKARO_DIFF_BASELINE'] === '1';
test.skip(
  !profile || !project || !chat,
  'Requires an isolated real profile and its recorded edits',
);

test('opens the complete real large diff, scrolls and copies it without mounting every line', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('Page error:', error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('Console:', message.text());
    });
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, project!, chat!)).click();
    const target = await page.evaluate(
      async ({ project, chat }) => {
        const view = await window.skaro.invoke('chat.open', project, chat, { paged: true });
        for (let at = 0; at < view.history!.count; at += 16) {
          const page = await window.skaro.invoke('history.page', view.history!, at, 16);
          for (const [offset, block] of page.blocks.entries()) {
            if (block.type !== 'row' || block.row.type !== 'turn_end') continue;
            const file = block.row.files.find(
              (file) =>
                file.path.endsWith('index.html') &&
                file.diffs.some((diff) => diff.length > 1_000_000),
            );
            if (file) return { index: at + offset, file, fileIndex: block.row.files.indexOf(file) };
          }
        }
        throw new Error('The real recorded large HTML edit is missing');
      },
      { project: project!, chat: chat! },
    );
    const expected = numberedDiffLines(target.file.diffs, target.file.change);
    const feed = page.locator('.chat .fd-feed > .virtual-blocks');
    const scroller = page.locator('.chat .feed-wrap > .scroller');
    await scroller.hover({ position: { x: 10, y: 20 } });
    await page.mouse.wheel(0, -100_000);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(3);
    const block = feed.locator(`:scope > [data-history-index="${target.index}"]`);
    for (let step = 0; step < 160 && !(await block.count()); step++) {
      await scroller.evaluate((node) => {
        node.scrollTop += node.clientHeight * 0.7;
      });
      await page.waitForTimeout(40);
    }
    await expect(block).toBeAttached();
    const button = block.locator('.fd-turn-files .line').first();
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.diffLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.diffLongTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    let started = Date.now();
    await button.click({ delay: 80 });
    console.log(
      'After native click:',
      await page.evaluate(() => ({
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        rows: document.querySelectorAll('.dm-row').length,
      })),
    );

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let at = 0; at < target.fileIndex; at++) {
      if (at === target.fileIndex - 1) {
        started = Date.now();
        await page.evaluate(() => {
          window.diffLongTasks = [];
        });
      }
      await dialog.getByRole('button', { name: 'Следующий файл', exact: true }).click();
    }
    await expect(dialog.locator('.dm-path')).toContainText('index.html');
    const body = dialog.locator('.dm-body');
    const rows = body.locator('.dm-row,.dm-hunk');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => body.locator('.dm-code').first().textContent()).toBe(expected[0]!.text);
    console.log('Real diff initial:', {
      chars: target.file.diffs.join('').length,
      lines: expected.length,
      mounted: await rows.count(),
      elapsed: Date.now() - started,
      longTasks: await page.evaluate(() => window.diffLongTasks),
    });
    if (!baseline) {
      const expand = dialog.getByRole('button', { name: 'Развернуть', exact: true });
      await expand.evaluate((button) => {
        const dialog = button.closest<HTMLElement>('[role="dialog"]')!;
        let start = 0;
        button.addEventListener('keydown', () => {
          start = performance.now();
        });
        const observer = new MutationObserver(() => {
          if (!start || !dialog.classList.contains('expanded')) return;
          requestAnimationFrame(() => {
            dialog.dataset['responseMs'] = String(performance.now() - start);
          });
          observer.disconnect();
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['class'] });
      });
      await expand.press('Enter');
      await expect(dialog).toHaveClass(/expanded/);
      await expect.poll(() => dialog.getAttribute('data-response-ms')).not.toBeNull();
      const response = Number(await dialog.getAttribute('data-response-ms'));
      console.log('Diff toggle acknowledgement (ms):', response);
      expect(response).toBeLessThan(150);
      await dialog.getByRole('button', { name: 'Свернуть', exact: true }).click();
    }
    await expect(body.locator('.dm-code span').first()).toBeAttached({ timeout: 30_000 });
    console.log(
      'Diff including completed syntax:',
      await page.evaluate(() => window.diffLongTasks),
    );
    const geometry = await rows.first().evaluate((node) => {
      const style = getComputedStyle(node);
      const code = node.querySelector('.dm-code')!;
      const codeStyle = getComputedStyle(code);
      return {
        height: node.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        font: style.font,
        background: style.backgroundColor,
        color: codeStyle.color,
        whiteSpace: codeStyle.whiteSpace,
        paddingRight: codeStyle.paddingRight,
      };
    });
    console.log('Real diff geometry:', geometry);
    await page.screenshot({ path: info.outputPath('large-diff-top.png') });
    if (baseline) return;
    expect(await rows.count()).toBeLessThan(expected.length);
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => body.locator('.dm-code').last().textContent())
      .toBe(expected.at(-1)!.text);
    await expect.poll(() => rows.count()).toBeLessThan(expected.length);
    await body
      .locator('.dm-code')
      .last()
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    const text = expected.map((line) => line.text).join('\n');
    await expect
      .poll(async () =>
        (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'),
      )
      .toBe(text);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await body.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect.poll(() => body.locator('.dm-code').first().textContent()).toBe(expected[0]!.text);
    await page.screenshot({ path: info.outputPath('large-diff-returned.png') });
    // Background history can move during measurement/restoration; the viewer owns its row.
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(dialog).toBeVisible();
    await expect(block).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(block).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
