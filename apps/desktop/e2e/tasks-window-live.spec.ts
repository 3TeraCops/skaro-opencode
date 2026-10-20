// Scroll, select and reorder the existing real tasks; no fixture or generated task is used.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires an isolated real project with a long task column');

test('keeps full task counts, selection and global reorder positions with windowed cards', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log('Renderer error:', error.message);
  });
  const saved = await page.evaluate(async (project) => {
    const tabs = await window.skaro.invoke('tabs.get');
    const workspace = (await window.skaro.invoke(
      'app.getSetting',
      'ui.workspace',
    )) as WorkspaceState;
    const view = await window.skaro.invoke('app.getSetting', `tasks.${project}.view`);
    const order = await window.skaro.invoke('app.getSetting', `tasks.${project}.boardOrder`);
    await window.skaro.invoke('tabs.set', {
      projects: [...new Set([...tabs.projects, project])],
      active: project,
    });
    await window.skaro.invoke('app.setSetting', `tasks.${project}.view`, 'board');
    await window.skaro.invoke('app.setSetting', 'ui.workspace', {
      ...workspace,
      view: 'project',
      sections: { ...workspace.sections, [project]: 'tasks' },
      openTasks: { ...workspace.openTasks, [project]: undefined },
    });
    return { tabs, workspace, view, order };
  }, project!);
  try {
    await page.reload();
    await page.screenshot({ path: info.outputPath('board-on-restore.png') });
    console.log('Restored headings:', await page.locator('h1').allTextContents());
    const tasks = await page.evaluate(
      (project) => window.skaro.invoke('tasks.list', project),
      project!,
    );
    const counts = await page.locator('.board > [data-col] > .head > .count').allTextContents();
    await expect
      .poll(async () =>
        (await page.locator('.board > [data-col] > .head > .count').allTextContents())
          .map(Number)
          .reduce((a, b) => a + b, 0),
      )
      .toBe(tasks.filter((task) => !task.archived && task.status !== 'cancelled').length);
    const columns = await page.locator('.board > [data-col]').evaluateAll((columns) =>
      columns.map((column) => ({
        key: (column as HTMLElement).dataset['col']!,
        count: Number(column.querySelector('.head > .count')!.textContent),
      })),
    );
    const largest = columns.toSorted((a, b) => b.count - a.count)[0]!;
    expect(largest.count).toBeGreaterThan(2);
    const column = page.locator(`.board > [data-col="${largest.key}"]`);
    await expect(column.locator('[data-card]').first()).toBeVisible();
    await expect
      .poll(() => column.locator('[data-card]').count())
      .toBeLessThanOrEqual(largest.count);
    const mounted = await column.locator('[data-card]').count();
    expect(mounted).toBeGreaterThan(0);
    const first = column.locator('[data-card]').first();
    const moved = await first.getAttribute('data-card');
    await first.focus();
    const milestone = tasks.find((task) => task.id === moved)?.milestone?.id;
    if (milestone) {
      const revision = await column.getAttribute('data-range-revision');
      // A real no-op move keeps the task files intact and emits the normal project refresh.
      await page.evaluate(
        async ({ project, task, milestone }) => {
          await window.skaro.invoke('tasks.move', project, [task], milestone);
          await window.skaro.invoke('tasks.catalog', project);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        },
        { project: project!, task: moved!, milestone },
      );
      await expect(column).not.toHaveAttribute('data-range-revision', revision!);
      await expect(first).toBeFocused();
    }
    await page.keyboard.press('Space');
    for (let at = 1; at < largest.count; at++) await page.keyboard.press('ArrowDown');
    await expect(column.locator('.slot')).toBeVisible();
    await page.keyboard.press('Space');
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ project, key }) => {
            const order = (await window.skaro.invoke(
              'app.getSetting',
              `tasks.${project}.boardOrder`,
            )) as Record<string, string[]>;
            return order?.[key]?.at(-1);
          },
          { project: project!, key: largest.key },
        ),
      )
      .toBe(moved);
    await expect(column.locator(`[data-card="${moved}"]`)).toBeFocused();
    // Reordering at the end of a scrolled column must use global positions as well.
    const source = column.locator(`[data-card="${moved}"]`);
    const target = column.locator('[data-card]').nth(-2);
    await expect(source).toBeInViewport();
    await expect(target).toBeInViewport();
    const sourceBox = await source.boundingBox(),
      targetBox = await target.boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(targetBox).toBeTruthy();
    await page.mouse.move(sourceBox!.x + 30, sourceBox!.y + 15);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + 30, targetBox!.y + 4, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        page.evaluate(
          async ({ project, key, moved }) => {
            const order = (await window.skaro.invoke(
              'app.getSetting',
              `tasks.${project}.boardOrder`,
            )) as Record<string, string[]>;
            return order?.[key]?.indexOf(moved!);
          },
          { project: project!, key: largest.key, moved },
        ),
      )
      .toBe(largest.count - 2);
    // Select all includes tasks outside the viewport.
    await page.locator('[data-task-toolbar].pick').click();
    await column.getByRole('checkbox').first().check();
    await expect(page.locator('.screen > .bar > .count')).toContainText(String(largest.count));
    await page.screenshot({ path: info.outputPath('real-windowed-board.png') });
    await page.locator('.screen > .bar button[data-tip^="Архивировать"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.tasks .task').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('real-selected-tasks.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    await expect(page.locator('.list[data-task-list] .grid.row').first()).toBeVisible();
    expect(await page.locator('.list[data-task-list] .grid.row').count()).toBeLessThanOrEqual(
      tasks.filter((task) => !task.archived).length,
    );
    const ordered = await page.evaluate(async (project) => {
      const tasks = (await window.skaro.invoke('tasks.list', project)).filter(
        (task) => !task.archived,
      );
      const milestones = await window.skaro.invoke('plan.milestones', project);
      return [...milestones.map((m) => m.id), ''].flatMap((id) =>
        tasks.filter((task) => (task.milestone?.id ?? '') === id).map((task) => task.id),
      );
    }, project!);
    const edge = page.locator('.list[data-task-list] .grid.row').first();
    const edgeId = await edge.locator('.id').innerText();
    const nextId = ordered[ordered.indexOf(edgeId) + 1];
    expect(nextId).toBeTruthy();
    await edge
      .getByRole('checkbox')
      .evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.closest('.grid.row[data-task-list]')?.querySelector('.id')
              ?.textContent,
        ),
      )
      .toBe(nextId);

    await page.locator('.list[data-task-list]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => page.locator('.list[data-task-list] .grid.row .id').allTextContents())
      .not.toEqual([]);
    await page.screenshot({ path: info.outputPath('real-windowed-list.png') });
    expect(errors).toEqual([]);
    console.log('Real task windows:', {
      total: tasks.length,
      column: largest,
      mounted,
      initialCounts: counts,
    });
  } finally {
    await page.evaluate(
      async ({ project, saved }) => {
        await window.skaro.invoke('tabs.set', saved.tabs as TabsState);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', saved.workspace);
        await window.skaro.invoke('app.setSetting', `tasks.${project}.view`, saved.view);
        await window.skaro.invoke('app.setSetting', `tasks.${project}.boardOrder`, saved.order);
      },
      { project: project!, saved },
    );
    await app.close();
  }
});
