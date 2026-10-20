// Existing recorded file edits and native backend only. No generated history or API replacement.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { recordFeedback } from './record-feedback';
import { inspectInlineLongLine } from './inline-long-line-live';
import { revealChatRow } from './chat-list-live-support';
import { fileDiffLines } from '../src/renderer/src/feed/diff-model';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi; inlineLongTasks: number[] };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const chat = process.env['SKARO_VIRTUAL_CHAT'];
const baseline = process.env['SKARO_INLINE_BASELINE'] === '1';
test.skip(!profile || !project || !chat, 'Requires a copied real profile with recorded edits');

test('opens and scrolls the entire recorded inline diff with the existing layout and copy behavior', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    const workers: { created: number; closed?: number }[] = [];
    page.on('worker', (worker) => {
      if (!worker.url().includes('inline-diff')) return;
      const entry = { created: Date.now() } as { created: number; closed?: number };
      workers.push(entry);
      worker.on('close', () => {
        entry.closed = Date.now();
      });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(message.text());
    });
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, project!, chat!)).click();
    const target = await page.evaluate(
      async ({ project, chat }) => {
        const view = await window.skaro.invoke('chat.open', project, chat, { paged: true });
        for (let at = 0; at < view.history!.count; at += 16) {
          const root = await window.skaro.invoke('history.page', view.history!, at, 16);
          for (const [offset, block] of root.blocks.entries()) {
            if (block.type !== 'actions' || !block.history) continue;
            for (let nested = 0; nested < block.history.count; nested += 16) {
              const child = await window.skaro.invoke('history.page', block.history, nested, 16);
              for (const [index, row] of child.blocks.entries()) {
                if (
                  row.type === 'row' &&
                  row.row.type === 'file' &&
                  row.row.diffs.some((d) => d.length > 1_000_000)
                )
                  return { index: at + offset, nested: nested + index, row: row.row };
              }
            }
          }
        }
        throw new Error('The actual large recorded file edit is missing');
      },
      { project: project!, chat: chat! },
    );
    const expected = fileDiffLines(target.row);
    const scroller = page.locator('.chat .feed-wrap > .scroller');
    await scroller.hover({ position: { x: 10, y: 20 } });
    await page.mouse.wheel(0, -100_000);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(3);
    const block = page.locator(
      `.chat .fd-feed > .virtual-blocks > [data-history-index="${target.index}"]`,
    );
    for (let step = 0; step < 160 && !(await block.count()); step++) {
      await scroller.evaluate((node) => {
        node.scrollTop += node.clientHeight * 0.6;
      });
      await page.waitForTimeout(40);
    }
    await expect(block).toBeAttached();
    await block.locator('.fd-action-summary').click({ delay: 80 });
    const child = block.locator(
      `.fd-sublist > .virtual-blocks > [data-history-index="${target.nested}"]`,
    );
    for (let step = 0; step < 100 && !(await child.count()); step++) {
      await scroller.evaluate((node) => {
        node.scrollTop += node.clientHeight * 0.3;
      });
      await page.waitForTimeout(40);
    }
    await expect(child).toBeAttached();
    const button = child.locator('button.fd-row');
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.inlineLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.inlineLongTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    const feedback = await recordFeedback(child, '.fd-diff');
    const textFeedback = await recordFeedback(child, '.fd-diff-line', 'contentFeedbackMs');
    const start = Date.now();
    await button.click({ delay: 80 });
    const diff = child.locator('.fd-diff');
    const rows = diff.locator('.fd-diff-line');
    await expect(rows.first())
      .toBeVisible({ timeout: 30_000 })
      .catch(async (error: unknown) => {
        console.log(
          'Failed diff DOM:',
          await child.evaluate((node) => node.innerHTML.slice(-2200)),
        );
        for (const worker of page.workers())
          console.log(
            'Worker diagnostic:',
            worker.url(),
            await worker
              .evaluate(() => ({
                fonts: [...(self as unknown as { fonts: FontFaceSet }).fonts].map((font) => ({
                  family: font.family,
                  status: font.status,
                })),
                marks: performance
                  .getEntriesByType('mark')
                  .map((entry) => ({ name: entry.name, at: entry.startTime })),
                resources: performance
                  .getEntriesByType('resource')
                  .map((entry) => ({ name: entry.name, duration: entry.duration })),
              }))
              .catch(String),
          );
        throw error;
      });
    await expect
      .poll(() => rows.first().locator('span').last().textContent())
      .toBe(expected[0]!.text);
    const contentMs = Date.now() - start;
    if (!baseline)
      await expect.poll(() => diff.evaluate((node) => node.scrollWidth)).toBeGreaterThan(1_000_000);
    expect(workers.length).toBe(1);
    const geometry = await diff.evaluate((node) => {
      const style = getComputedStyle(node);
      const row = node.querySelector<HTMLElement>('.fd-diff-line')!;
      const rowStyle = getComputedStyle(row);
      return {
        height: node.getBoundingClientRect().height,
        scrollWidth: node.scrollWidth,
        scrollHeight: node.scrollHeight,
        padding: style.padding,
        radius: style.borderRadius,
        background: style.backgroundColor,
        lineHeight: style.lineHeight,
        rowHeight: row.getBoundingClientRect().height,
        gap: rowStyle.gap,
        rowPadding: rowStyle.padding,
        color: rowStyle.color,
        font: rowStyle.fontFamily,
      };
    });
    console.log('Inline real diff:', {
      chars: target.row.diffs.join('').length,
      lines: expected.length,
      mounted: await rows.count(),
      elapsed: Date.now() - start,
      contentMs,
      feedbackMs: await feedback(),
      textFeedbackMs: await textFeedback(),
      longTasks: await page.evaluate(() => window.inlineLongTasks),
      geometry,
    });
    await page.screenshot({ path: info.outputPath('inline-top.png') });
    if (baseline) return;
    expect(await feedback()).toBeGreaterThan(0);
    expect(await feedback()).toBeLessThan(150);
    expect(await rows.count()).toBeLessThan(expected.length);
    await inspectInlineLongLine(page, app, diff, expected, info);
    await diff.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => rows.last().locator('span').last().textContent())
      .toBe(expected.at(-1)!.text);
    await diff.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(async () =>
        diff.evaluate((node) => {
          node.scrollLeft = node.scrollWidth;
          return node.scrollLeft;
        }),
      )
      .toBeGreaterThan(1_000_000);
    await diff.evaluate((node) => {
      node.scrollLeft = 0;
    });
    // Native selection copies the complete selected row, including its sign.
    const last = rows.last();
    await last.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      expected.at(-1)!.text,
    );
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.locator('.chat .main > .head').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect
      .poll(async () =>
        (await app.evaluate(({ clipboard }) => clipboard.readText())).includes(
          target.row.diffs[0]!,
        ),
      )
      .toBe(true);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await diff.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect
      .poll(() => rows.first().locator('span').last().textContent())
      .toBe(expected[0]!.text);
    await button.click();
    await expect(diff).toHaveCount(0);
    await button.click();
    await expect(child.locator('.fd-diff-line').first()).toBeVisible();
    console.log(
      'Inline complete sequence long tasks:',
      await page.evaluate(() => window.inlineLongTasks),
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
