// Existing recorded conversation and native backend only; no generated history or IPC replacement.
import { expect, test } from '@playwright/test';
import { revealChatRow } from './chat-list-live-support';
import { launchApp } from './launch';
import { proposalChanges, type ProposalChange } from '../src/shared/proposal-changes';
import { withoutSkaroNote } from '@skaro/timeline';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const chat = process.env['SKARO_VIRTUAL_CHAT'];
test.skip(!profile || !project || !chat, 'Requires an isolated real profile and a long real chat');

test('virtualizes a real conversation and preserves access and copying across the full history', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        console.log('Renderer copy diagnostic:', message.text().slice(0, 500));
    });
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, project!, chat!)).click();
    const view = await page.evaluate(
      ({ project, chat }) => window.skaro.invoke('chat.open', project, chat, { paged: true }),
      { project: project!, chat: chat! },
    );
    expect(view.history?.itemCount).toBeGreaterThan(300);
    expect(view.timeline.items.length).toBeLessThan(80);
    expect(view.timeline.items.filter((item) => item.kind === 'proposal')).toEqual([]);
    const changes: ProposalChange[] = [];
    for (let at = 0; at < view.history!.changeCount!; at += 16) {
      const rows = await page.evaluate(
        ({ source, at }) => window.skaro.invoke('history.changes', source, at),
        { source: view.history!, at },
      );
      expect(rows.length).toBeLessThanOrEqual(16);
      changes.push(...rows);
    }
    const canonical = await page.evaluate(
      ({ project, chat }) => window.skaro.invoke('chat.open', project, chat),
      { project: project!, chat: chat! },
    );
    const expectedChanges = canonical.timeline.items.flatMap((item) =>
      item.kind === 'proposal' ? proposalChanges(item) : [],
    );
    expect(changes).toEqual(expectedChanges);
    expect(changes.length).toBe(view.history!.changeCount);
    expect(changes.length).toBeGreaterThan(0);
    const beginning = await page.evaluate(
      (source) => window.skaro.invoke('history.page', source, 0, 16),
      view.history!,
    );
    const feed = page.locator('.chat .fd-feed');
    const scroller = page.locator('.chat .feed-wrap > .scroller');
    const blocks = feed.locator(':scope > .virtual-blocks > [data-feed-block]');
    await expect(blocks.first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => blocks.count()).toBeLessThan(60);
    const endIds = await blocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-feed-block')),
    );
    await scroller.hover({ position: { x: 10, y: 20 } });
    await page.mouse.wheel(0, -100_000);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(3);
    await expect
      .poll(async () => (await blocks.first().getAttribute('data-feed-block')) !== endIds[0])
      .toBe(true);
    await expect.poll(() => blocks.count()).toBeLessThan(60);
    const firstBlock = beginning.blocks.find(
      (block) => block.type === 'row' && block.row.type === 'user',
    );
    const firstUser =
      firstBlock?.type === 'row' && firstBlock.row.type === 'user'
        ? firstBlock.row.item
        : undefined;
    expect(firstUser?.kind).toBe('message');
    if (firstUser?.kind !== 'message') throw new Error('The real conversation has no user message');
    await expect(feed.locator('.fd-bubble').first()).toContainText(
      withoutSkaroNote(firstUser.text),
    );
    await page.evaluate(() => {
      document.addEventListener('copy', (event) => {
        queueMicrotask(() => {
          document.body.dataset['historyCopyEvent'] = JSON.stringify({
            prevented: event.defaultPrevented,
            focused: document.hasFocus(),
            activeElement: document.activeElement?.tagName,
            collapsed: getSelection()?.isCollapsed,
            anchorConnected: getSelection()?.anchorNode?.isConnected,
            at: performance.now(),
          });
        });
      });
    });
    await page.locator('.chat .main > .head').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    const copyingAt = Date.now();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    const copyEvent = JSON.parse(
      (await page.locator('body').getAttribute('data-history-copy-event'))!,
    );
    console.log('Whole-history copy event:', copyEvent);
    expect(copyEvent.prevented).toBe(true);
    await expect
      .poll(
        async () =>
          (await app.evaluate(({ clipboard }) => clipboard.readText())).includes(
            withoutSkaroNote(firstUser.text),
          ),
        {
          message: 'Whole-history copy must reach the clipboard through the native backend',
          timeout: 15_000,
        },
      )
      .toBe(true);
    console.log('Whole-history clipboard completion (ms):', Date.now() - copyingAt);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain(withoutSkaroNote(firstUser.text));
    const lastReply = view.timeline.items.findLast(
      (item) => item.kind === 'message' && item.role === 'agent' && !item.parentId,
    );
    if (lastReply?.kind !== 'message') throw new Error('The real conversation has no agent reply');
    expect(copied).toContain(lastReply.text);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.locator('.chat .feed-wrap > .down').click();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(5);
    await expect.poll(() => blocks.count()).toBeLessThan(60);
    await page.screenshot({ path: info.outputPath('virtual-real-history.png') });
    const change = page.locator('.changed-list .changed-row').first();
    const id = await change.getAttribute('data-proposal-id');
    expect(id).toBeTruthy();
    await change.click();
    await expect(page.locator(`[id="proposal-${id}"]`)).toBeInViewport();
    await expect(page.locator('.chat .feed-wrap > .down')).toBeVisible();
    console.log('Real virtual history:', {
      items: view.history?.itemCount,
      headerItems: view.timeline.items.length,
      mounted: await blocks.count(),
      copied: copied.length,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
