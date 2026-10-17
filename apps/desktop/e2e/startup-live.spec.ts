// Opt-in checks of the real app/profile. No seeded projects or replacement API responses.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

const userData = process.env['SKARO_STARTUP_USER_DATA'];
const projectId = process.env['SKARO_STARTUP_PROJECT_ID'];
test.skip(!userData || !projectId, 'Requires a real Skaro profile and an existing project');

/** Observe real disk reads and main-process stalls without changing their results. */
async function idleMetrics(app: ElectronApplication, root: string) {
  return app.evaluate(async (_electron, projectRoot) => {
    const fs = process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises');
    const { monitorEventLoopDelay } = process.getBuiltinModule(
      'perf_hooks',
    ) as typeof import('node:perf_hooks');
    const original = fs.readFile;
    const prefix = `${projectRoot.replaceAll('\\', '/').toLowerCase()}/.skaro/`;
    let artifactReads = 0;
    let lastRead = Date.now();
    const loads: string[] = [];
    fs.readFile = ((...args: Parameters<typeof original>) => {
      if (String(args[0]).replaceAll('\\', '/').toLowerCase().startsWith(prefix)) {
        artifactReads++;
        lastRead = Date.now();
        if (String(args[0]).endsWith('config.yaml')) loads.push(new Error().stack ?? '');
      }
      return original(...args);
    }) as typeof original;
    const delay = monitorEventLoopDelay({ resolution: 10 });
    try {
      // Startup recovery is asynchronous. Require five quiet seconds (longer
      // than a monitor interval), so repeated three-second reloads still fail.
      const started = Date.now();
      while (Date.now() - lastRead < 5000) {
        if (Date.now() - started > 60_000) throw new Error('Project reads never settled');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const startupReads = artifactReads;
      artifactReads = 0;
      loads.length = 0;
      const cpu = process.cpuUsage();
      delay.enable();
      // Covers three of the production monitor's three-second sweeps.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      const used = process.cpuUsage(cpu);
      return {
        artifactReads,
        startupReads,
        loads,
        maxDelayMs: delay.max / 1e6,
        cpuMs: (used.user + used.system) / 1000,
      };
    } finally {
      delay.disable();
      fs.readFile = original;
    }
  }, root);
}

// eslint-disable-next-line no-empty-pattern
test('starts on Home, retains tabs and reuses unchanged project artifacts across idle sweeps', async ({}, testInfo) => {
  test.setTimeout(180_000);
  let app = await launchApp(userData!, { openSavedProject: false });
  const errors: string[] = [];
  try {
    let page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.bar .home.current')).toBeVisible({ timeout: 60_000 });
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    const project = projects.find((item) => item.id === projectId);
    expect(project, 'The real project must exist').toBeTruthy();
    const tab = page.getByRole('tab').filter({ hasText: project!.name });
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    await tab.click();
    await expect(page.locator('.project-nav')).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const tasks = await page.evaluate((id) => window.skaro.invoke('tasks.list', id), projectId!);
    expect(tasks.length).toBeGreaterThan(0);
    const tabs = await page.evaluate(() => window.skaro.invoke('tabs.get'));
    expect(tabs.active).toBe(projectId);
    const metrics = await idleMetrics(app, project!.path);
    console.log('Idle project metrics:', JSON.stringify(metrics));
    expect(metrics.artifactReads, 'Unchanged artifacts must not be reloaded by idle sweeps').toBe(
      0,
    );
    await page.screenshot({ path: testInfo.outputPath('project.png') });
    await app.close();
    app = await launchApp(userData!, { openSavedProject: false });
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.bar .home.current')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.project-nav')).toHaveCount(0);
    await expect(page.getByRole('tab').filter({ hasText: project!.name })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    const restored = await page.evaluate(() => window.skaro.invoke('tabs.get'));
    expect(restored.projects).toEqual(tabs.projects);
    expect(restored.active).toBeUndefined();
    await expect(page.locator('.projects .card, .projects .item-row')).toHaveCount(
      projects.length,
      { timeout: 30_000 },
    );
    await page.screenshot({ path: testInfo.outputPath('home-after-restart.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
