import {
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { DiffLine } from '../src/renderer/src/feed/diff-model';
import { browserTrace } from './browser-trace';

/** Read and copy the longest existing recorded line; trace only this actual interaction. */
export async function inspectInlineLongLine(
  page: Page,
  app: ElectronApplication,
  diff: Locator,
  expected: DiffLine[],
  info: TestInfo,
) {
  const largest = expected.reduce(
    (best, line, index) => (line.text.length > best.line.text.length ? { line, index } : best),
    { line: expected[0]!, index: 0 },
  );
  const session = await page.context().newCDPSession(page);
  const stop = await browserTrace(session, info.outputPath('long-line.trace.json'));
  try {
    await diff.evaluate((node, index) => {
      performance.mark('inline.huge.scroll');
      node.scrollTop = index * Number.parseFloat(getComputedStyle(node).lineHeight);
    }, largest.index);
    const huge = diff.locator(`[data-feed-block="${largest.index}"] .fd-diff-line`);
    await expect(huge).toBeVisible();
    await expect.poll(() => huge.textContent()).toContain(largest.line.text.slice(0, 40));
    const geometry = await huge.evaluate((node) => {
      performance.mark('inline.huge.ready');
      const box = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      return {
        height: box.height,
        font: style.fontFamily,
        lineHeight: style.lineHeight,
        color: style.color,
        padding: style.padding,
        gap: style.gap,
        chars: node.textContent!.length,
      };
    });
    console.log('Actual largest inline line:', { length: largest.line.text.length, geometry });
    await page.screenshot({ path: info.outputPath('inline-long-line.png') });
    if (!process.env['SKARO_INLINE_LINE_BASELINE']) {
      await expect(huge.locator('.cm-content')).toBeAttached();
      expect(geometry.height).toBe(19.5);
      expect(geometry.chars).toBeLessThan(8000);
      await diff.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
      });
      await expect.poll(() => huge.textContent()).toContain(largest.line.text.slice(-40));
      console.log(
        'Largest line at horizontal end:',
        await huge.evaluate((node) => ({
          chars: node.textContent!.length,
          textColor: getComputedStyle(node.querySelector('.cm-content')!).color,
          textHeight: node.querySelector('.cm-content')!.getBoundingClientRect().height,
        })),
      );
      await page.screenshot({ path: info.outputPath('inline-long-line-end.png') });
    }
    await huge.evaluate((node) => {
      performance.mark('inline.huge.select');
      getSelection()?.selectAllChildren(node);
    });
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      largest.line.text,
    );
    await page.evaluate(() => {
      performance.mark('inline.huge.copied');
      getSelection()?.removeAllRanges();
    });
    if (!process.env['SKARO_INLINE_LINE_BASELINE']) {
      await diff.evaluate((node) => {
        node.scrollLeft = 300_000;
      });
      await expect.poll(() => diff.evaluate((node) => node.scrollLeft)).toBe(300_000);
      await page.waitForTimeout(80);
      const top = (await huge.boundingBox())!.y;
      const extendSelection = async () =>
        diff.evaluate(
          (node, { top }) => {
            const selection = getSelection()!;
            const anchor = selection.anchorNode,
              offset = selection.anchorOffset;
            const range = document.caretRangeFromPoint(
              node.getBoundingClientRect().left + 40,
              top + 10,
            )!;
            const text = range.startContainer;
            if (text.nodeType !== Node.TEXT_NODE) throw new Error('No native visible text');
            const end = Math.min(range.startOffset + 160, text.textContent!.length);
            const sample = text.textContent!.slice(end - 160, end);
            range.setEnd(text, end);
            range.setStart(anchor!, offset);
            selection.removeAllRanges();
            selection.addRange(range);
            return sample;
          },
          { top },
        );
      const box = (await diff.boundingBox())!;
      const originalContent = await huge.locator('.cm-content').elementHandle();
      await page.mouse.move(box.x + 40, top + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(box.width - 20, 500), top + 10, { steps: 12 });
      await page.mouse.up();
      const start = (await page.evaluate(() => getSelection()?.toString()))!;
      expect(await originalContent!.evaluate((node) => node.isConnected)).toBe(true);
      await originalContent!.dispose();
      expect(start.length).toBeGreaterThan(10);
      expect(largest.line.text).toContain(start);
      await page.keyboard.press('Control+c');
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(start);
      await diff.evaluate((node) => {
        node.scrollLeft += 50_000;
      });
      await page.waitForTimeout(80);
      const end = await extendSelection();
      const from = largest.line.text.indexOf(start),
        to = largest.line.text.indexOf(end, from + start.length) + 160;
      expect(from).toBeGreaterThan(0);
      expect(largest.line.text.lastIndexOf(start)).toBe(from);
      expect(largest.line.text.lastIndexOf(end)).toBe(to - 160);
      expect(to - from).toBeGreaterThan(1000);
      await page.keyboard.press('Control+c');
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(largest.line.text.slice(from, to));
      await page.evaluate(() => getSelection()?.removeAllRanges());
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+c');
      await expect
        .poll(async () =>
          (await app.evaluate(({ clipboard }) => clipboard.readText())).includes(largest.line.text),
        )
        .toBe(true);
      await page.evaluate(() => getSelection()?.removeAllRanges());
    }
    await diff.evaluate((node) => {
      node.scrollLeft = 0;
    });
  } finally {
    await stop?.();
    await session.detach();
  }
}
