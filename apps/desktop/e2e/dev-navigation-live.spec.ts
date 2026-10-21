import { chromium, expect, test, type Page } from '@playwright/test';

const endpoint = process.env['SKARO_DEV_CDP'];
test.skip(!endpoint, 'Requires the native dev app with an existing real project open');

async function section(page: Page, label: string, selector: string): Promise<void> {
  await page
    .locator('.project-nav')
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click();
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.project .loading')).toHaveCount(0, { timeout: 60_000 });
}

test('dev navigation keeps one Svelte runtime after loading lazy graph and chat dependencies', async () => {
  test.setTimeout(240_000);
  await expect
    .poll(
      () =>
        fetch(`${endpoint}/json/version`)
          .then((r) => r.ok)
          .catch(() => false),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
  const browser = await chromium.connectOverCDP(endpoint!);
  const page = browser.contexts()[0]!.pages()[0]!;
  const errors: string[] = [];
  const failed: string[] = [];
  let reloads = 0;
  const onerror = (error: Error) => errors.push(error.message);
  const onresponse = (response: import('@playwright/test').Response) => {
    if (response.status() >= 400 && response.url().startsWith(page.url().split('/src/')[0]!))
      failed.push(`${response.status()} ${response.url()}`);
  };
  const onnavigation = (frame: import('@playwright/test').Frame) => {
    if (frame === page.mainFrame()) reloads++;
  };
  page.on('pageerror', onerror);
  page.on('response', onresponse);
  page.on('framenavigated', onnavigation);
  try {
    await expect(page.locator('.project-nav')).toBeVisible({ timeout: 60_000 });
    await section(page, 'C4', '[data-c4-gallery]');
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Граф связей', exact: true })
      .click();
    await expect(page.locator('.graph-workspace')).toBeVisible({ timeout: 60_000 });
    for (let pass = 0; pass < 2; pass++) {
      await section(page, 'План', '[data-plan-screen]');
      await section(page, 'Задачи', '[data-task-tasks-screen]');
      await section(page, 'Чат', '[data-chat-screen]');
      await section(page, 'Параметры', '[data-project-params].cards');
    }
    await page.screenshot({ path: test.info().outputPath('parameters.png') });
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
    expect(reloads).toBe(0);
  } finally {
    page.off('pageerror', onerror);
    page.off('response', onresponse);
    page.off('framenavigated', onnavigation);
    await browser.close();
  }
});
