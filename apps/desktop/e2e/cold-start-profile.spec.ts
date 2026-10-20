import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { launchApp } from './launch';
import { browserTrace } from './browser-trace';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi; startupLongTasks: number[] };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
test.skip(!profile, 'Requires the separate real test profile');

test('profiles actual cold launches and renderer initialization without replacing backend responses', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const samples = [];
  for (let index = 0; index < 3; index++) {
    const app = await launchApp(profile!, { openSavedProject: false });
    app.process().stdout?.on('data', (data: Buffer) => process.stdout.write(String(data)));
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.project-nav')).toBeVisible();
      await expect(page.locator('.chat .fd-feed')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => performance.getEntriesByName('first-contentful-paint').length),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          page.evaluate(() => performance.getEntriesByName('skaro.history.content').length),
        )
        .toBeGreaterThan(0);
      const created = await app.evaluate(
        ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Browser')!.creationTime,
      );
      const main = await app.evaluate(() =>
        performance
          .getEntriesByType('mark')
          .filter((entry) => entry.name.startsWith('skaro:'))
          .map((entry) => ({ name: entry.name, at: entry.startTime })),
      );
      const loads = await app.evaluate(() => {
        const probe = Reflect.get(globalThis, Symbol.for('skaro.startupLoads'));
        return probe ? { ...probe, stop: undefined } : undefined;
      });
      if (process.env['SKARO_LOAD_TRACE']) {
        expect(loads).toBeDefined();
        const requests = loads.records.map((record: { request: string }) => record.request);
        expect(requests).not.toContain('yaml');
        expect(requests).not.toContain('electron-updater');
      }
      samples.push(
        await page.evaluate(
          ({ created, main, loads }) => ({
            main,
            loads,
            created,
            firstContent:
              performance.timeOrigin +
              performance.getEntriesByName('first-contentful-paint')[0]!.startTime -
              created,
            history:
              performance.timeOrigin +
              performance.getEntriesByName('skaro.history.content').at(-1)!.startTime -
              created,
            navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
            resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
          }),
          { created, main, loads },
        ),
      );
      if (index === 2) {
        await page.addInitScript(() => {
          window.startupLongTasks = [];
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.startupLongTasks.push(entry.duration);
          }).observe({ type: 'longtask', buffered: true });
        });
        const session = await page.context().newCDPSession(page);
        const stopTrace = await browserTrace(session, info.outputPath('startup.trace.json'));
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
        await page.reload();
        await expect(page.locator('.chat .fd-feed')).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => performance.getEntriesByName('skaro.history.content').length),
          )
          .toBeGreaterThan(0);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const { profile: cpu } = await session.send('Profiler.stop');
        await stopTrace?.();
        await writeFile(info.outputPath('startup.cpuprofile'), JSON.stringify(cpu));
        console.log(
          'Renderer initialization long tasks:',
          await page.evaluate(() => window.startupLongTasks),
        );
      }
    } finally {
      await app.close();
    }
  }
  await writeFile(info.outputPath('cold-start.json'), JSON.stringify(samples, null, 2));
  console.log(
    'Cold startup samples:',
    JSON.stringify(samples.map(({ firstContent, history }) => ({ firstContent, history }))),
  );
  console.log('Main startup milestones:', JSON.stringify(samples.map((sample) => sample.main)));
});
