// Exercise the owner's real board action on an existing task in an isolated real checkout.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_LAUNCH_PROJECT'];
const taskId = process.env['SKARO_LAUNCH_TASK'];
test.skip(
  !profile || !projectId || !taskId,
  'Requires an existing runnable task in a copied real project',
);

test('shows queue feedback on the real board before task preparation finishes', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  let previous: { tabs: TabsState; workspace: WorkspaceState } | undefined;
  try {
    previous = await page.evaluate(
      async ({ project }) => {
        const tabs = await window.skaro.invoke('tabs.get');
        const workspace = (await window.skaro.invoke(
          'app.getSetting',
          'ui.workspace',
        )) as WorkspaceState;
        await window.skaro.invoke('tabs.set', {
          projects: tabs.projects.includes(project) ? tabs.projects : [...tabs.projects, project],
          active: project,
        });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          ...workspace,
          view: 'project',
          sections: { ...workspace.sections, [project]: 'tasks' },
          openTasks: { ...workspace.openTasks, [project]: undefined },
        });
        return { tabs, workspace };
      },
      { project: projectId! },
    );
    await page.reload();
    await expect(page.locator('.screen > .top h1')).toHaveText('Задачи');
    const card = page.locator(`.board [data-card="${taskId}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-task-toolbar].pick').click();
    await card.click();
    await expect(card).toHaveClass(/selected/);
    const run = page.locator('.bar > .run');
    const feedback = await run.evaluate((button, task) => {
      const started = performance.now();
      return new Promise<{ queued: boolean; elapsed: number }>((resolve) => {
        (button as HTMLButtonElement).click();
        requestAnimationFrame(() =>
          resolve({
            queued: !!document.querySelector(`.board [data-card="${task}"] .queue`),
            elapsed: performance.now() - started,
          }),
        );
      });
    }, taskId!);
    console.log('First task launch frame:', feedback);
    expect(feedback.queued).toBe(true);
    const queued = page.locator(`.board [data-col="working"] [data-card="${taskId}"]`);
    await expect(queued).toBeVisible({ timeout: 1000 });
    await expect(queued.locator('.queue')).toBeVisible();
    await page.screenshot({ path: info.outputPath('task-queue-feedback.png') });
    // Stop the real run promptly; verification must not continue implementing the task.
    await expect
      .poll(
        async () => {
          const view = await page.evaluate(
            ({ project, task }) => window.skaro.invoke('task.open', project, task),
            { project: projectId!, task: taskId! },
          );
          return view.run?.live;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.evaluate(({ project, task }) => window.skaro.invoke('tasks.cancel', project, task), {
      project: projectId!,
      task: taskId!,
    });
    await expect(page.locator(`.board [data-col="todo"] [data-card="${taskId}"]`)).toBeVisible();
  } finally {
    // A failed feedback assertion must also stop the real trial run before restoring the UI.
    await page.evaluate(
      async ({ project, task }) => {
        const view = await window.skaro.invoke('task.open', project, task);
        if (view.run?.live || view.task.status === 'queued')
          await window.skaro.invoke('tasks.cancel', project, task);
      },
      { project: projectId!, task: taskId! },
    );
    if (previous) {
      await page.evaluate(async ({ tabs, workspace }) => {
        await window.skaro.invoke('tabs.set', tabs);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', workspace);
      }, previous);
      await page.reload();
    }
    await app.close();
  }
});
