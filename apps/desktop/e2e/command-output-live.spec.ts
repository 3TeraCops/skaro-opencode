// Actual recorded commands, native task backend and the copied profile; no generated output.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { recordFeedback } from './record-feedback';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi; outputLongTasks: number[] };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const task = process.env['SKARO_HISTORY_TASK'];
const baseline = process.env['SKARO_OUTPUT_BASELINE'] === '1';
test.skip(
  !profile || !project || !task,
  'Requires a copied real task with large recorded command output',
);

test('preserves full command output and selection while bounding DOM for giant lines', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(240_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  let previous: { tabs: TabsState; workspace: WorkspaceState } | undefined;
  try {
    previous = await page.evaluate(
      async ({ project, task }) => {
        const tabs = await window.skaro.invoke('tabs.get');
        const workspace = (await window.skaro.invoke(
          'app.getSetting',
          'ui.workspace',
        )) as WorkspaceState;
        await window.skaro.invoke('tabs.set', { projects: tabs.projects, active: project });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          ...workspace,
          view: 'project',
          sections: { ...workspace.sections, [project]: 'tasks' },
          openTasks: { ...workspace.openTasks, [project]: task },
        });
        return { tabs, workspace };
      },
      { project: project!, task: task! },
    );
    await page.reload();
    await expect(page.locator('.task-conversation .fd-feed')).toBeVisible({ timeout: 60_000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const targets = await page.evaluate(
      async ({ project, task }) => {
        const view = await window.skaro.invoke('task.open', project, task, { paged: true });
        const found = [];
        for (let at = 0; at < view.history!.count; at += 16) {
          const root = await window.skaro.invoke('history.page', view.history!, at, 16);
          for (const [offset, block] of root.blocks.entries()) {
            if (block.type !== 'actions' || !block.history) continue;
            const child = await window.skaro.invoke('history.page', block.history, 0, 16);
            for (const [nested, entry] of child.blocks.entries()) {
              if (entry.type !== 'row' || entry.row.type !== 'command') continue;
              const item = entry.row.item;
              if (
                item.output.length > 1_000_000 ||
                (item.command.startsWith('Get-Content AGENTS.md') && item.output.length > 600_000)
              )
                found.push({ root: at + offset, nested, item });
            }
          }
        }
        return found;
      },
      { project: project!, task: task! },
    );
    expect(targets).toHaveLength(2);
    const scroller = page.locator('.task-conversation .feed-wrap > .scroller');
    for (const [index, target] of targets.entries()) {
      await scroller.hover({ position: { x: 10, y: 20 } });
      await page.mouse.wheel(0, -1_000_000);
      await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(3);
      const root = page.locator(
        `.task-conversation .fd-feed > .virtual-blocks > [data-history-index="${target.root}"]`,
      );
      for (let step = 0; step < 600 && !(await root.count()); step++) {
        await scroller.evaluate((node) => {
          node.scrollTop += node.clientHeight * 0.5;
        });
        await page.waitForTimeout(40);
      }
      await expect(root).toBeAttached();
      const toggle = root.locator('.fd-action-summary');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true')
        await toggle.click({ delay: 80 });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const row = root.locator(
        `.fd-sublist > .virtual-blocks > [data-history-index="${target.nested}"]`,
      );
      // Nested history is virtual too: scroll to mount the requested command before revealing it.
      for (let step = 0; step < 120 && !(await row.count()); step++) {
        await scroller.evaluate((node) => {
          node.scrollTop += node.clientHeight * 0.25;
        });
        await page.waitForTimeout(40);
      }
      await expect(row).toBeAttached();
      const button = row.locator('.fd-row-wrap');
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.outputLongTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.outputLongTasks.push(entry.duration);
        }).observe({ type: 'longtask', buffered: false });
      });
      const feedback = await recordFeedback(row, '.fd-output');
      const textFeedback = await recordFeedback(row, '.cm-line', 'contentFeedbackMs');
      const start = Date.now();
      await button.click({ delay: 80 });
      const output = row.locator('.fd-output');
      await expect(output).toBeVisible();
      const full = row.locator('.fd-link-btn');
      if (await full.count()) await full.click();
      const longest = target.item.output
        .split('\n')
        .reduce(
          (best, line, index) =>
            line.length > best.length ? { index, length: line.length } : best,
          { index: 0, length: 0 },
        );
      if (!baseline)
        await expect
          .poll(() => output.evaluate((node) => node.scrollWidth))
          .toBeGreaterThan(longest.length * 7);
      const geometry = await output.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          height: node.getBoundingClientRect().height,
          width: node.getBoundingClientRect().width,
          padding: style.padding,
          font: style.fontFamily,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          color: style.color,
          background: style.backgroundColor,
          radius: style.borderRadius,
          scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight,
        };
      });
      console.log('Real command output:', {
        id: target.item.id,
        chars: target.item.output.length,
        mountedChars: (await output.textContent())!.length,
        elapsed: Date.now() - start,
        feedbackMs: await feedback(),
        textFeedbackMs: await textFeedback(),
        longTasks: await page.evaluate(() => window.outputLongTasks),
        geometry,
      });
      await page.screenshot({ path: info.outputPath(`command-${index}.png`) });
      if (baseline) {
        await button.click();
        continue;
      }
      expect(await feedback()).toBeGreaterThan(0);
      expect(await feedback()).toBeLessThan(150);
      expect((await output.textContent())!.length).toBeLessThan(target.item.output.length / 2);
      await output.evaluate((node) => {
        node.scrollLeft = 1_000_000;
      });
      await expect.poll(() => output.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100_000);
      await output.evaluate(async (node, index) => {
        node.scrollTop = index * Number.parseFloat(getComputedStyle(node).lineHeight);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, longest.index);
      // Select a visible real fragment after both vertical and horizontal virtual scrolling.
      await output.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const range = document.caretRangeFromPoint(box.left + 40, box.top + 17);
        if (!range || range.startContainer.nodeType !== Node.TEXT_NODE)
          throw new Error('No visible text at the viewport point');
        const text = range.startContainer;
        const from = Math.min(range.startOffset, text.textContent!.length - 160);
        range.setStart(text, Math.max(0, from));
        range.setEnd(text, Math.max(0, from) + 160);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      });
      const selected = await page.evaluate(() => getSelection()?.toString());
      expect(selected?.length).toBe(160);
      expect(target.item.output).toContain(selected!);
      await page.keyboard.press('Control+c');
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
      await output.evaluate(async (node) => {
        node.scrollLeft += 50_000;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const endSample = await output.evaluate((node) => {
        const selection = getSelection()!;
        const anchor = selection.anchorNode!,
          offset = selection.anchorOffset;
        const box = node.getBoundingClientRect();
        const endpoint = document.caretRangeFromPoint(box.left + 40, box.top + 17)!;
        const text = endpoint.startContainer;
        if (text.nodeType !== Node.TEXT_NODE || !anchor.isConnected)
          throw new Error('Native selection endpoint was lost');
        const end = Math.min(endpoint.startOffset + 160, text.textContent!.length);
        const sample = text.textContent!.slice(end - 160, end);
        const range = document.createRange();
        range.setStart(anchor, offset);
        range.setEnd(text, end);
        selection.removeAllRanges();
        selection.addRange(range);
        return sample;
      });
      const raw = target.item.output.split('\n')[longest.index]!;
      const from = raw.indexOf(selected!),
        to = raw.indexOf(endSample, from + 160) + 160;
      expect(from).toBeGreaterThan(0);
      expect(raw.lastIndexOf(selected!)).toBe(from);
      expect(raw.lastIndexOf(endSample)).toBe(to - 160);
      expect(to - from).toBeGreaterThan(1000);
      await page.keyboard.press('Control+c');
      await expect
        .poll(async () =>
          (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'),
        )
        .toBe(raw.slice(from, to));

      // A native selection spanning the command header and output includes every virtual gap.
      await row.evaluate((node) => getSelection()?.selectAllChildren(node));
      await page.keyboard.press('Control+c');
      await expect
        .poll(async () =>
          (await app.evaluate(({ clipboard }) => clipboard.readText()))
            .replace(/\r\n/g, '\n')
            .includes(target.item.output.trimEnd().replace(/\r\n/g, '\n')),
        )
        .toBe(true);
      await page.evaluate(() => getSelection()?.removeAllRanges());
      await page.locator('.task-conversation .fd-feed').evaluate((node) => {
        const scroller = node.closest<HTMLElement>('.scroller')!;
        scroller.scrollTop = 0;
      });
      // Full feed copy must still include this complete command, not just its visible fragments.
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+c');
      await expect
        .poll(async () =>
          (await app.evaluate(({ clipboard }) => clipboard.readText())).includes(
            target.item.output,
          ),
        )
        .toBe(true);
      await page.evaluate(() => getSelection()?.removeAllRanges());
    }
    console.log(
      'Command complete sequence long tasks:',
      await page.evaluate(() => window.outputLongTasks),
    );
    expect(errors).toEqual([]);
  } finally {
    if (previous)
      await page.evaluate(async ({ tabs, workspace }) => {
        await window.skaro.invoke('tabs.set', tabs);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', workspace);
      }, previous);
    await app.close();
  }
});
