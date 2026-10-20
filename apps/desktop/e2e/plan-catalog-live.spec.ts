// Preserve the actual plan/archive while the surrounding sections stop loading its full graph.
import { expect, test } from '@playwright/test';
import { collectPlanRows } from './plan-live-support';
import { launchApp } from './launch';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires an isolated real profile with a plan and archived tasks');
test('loads the real plan on demand and preserves the live and archived task groups', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let saved: { tabs: TabsState; workspace: WorkspaceState } | undefined;
  try {
    saved = await page.evaluate(async (project) => {
      const tabs = await window.skaro.invoke('tabs.get');
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      await window.skaro.invoke('tabs.set', {
        projects: [...new Set([...tabs.projects, project])],
        active: project,
      });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: 'plan' },
      });
      return { tabs, workspace };
    }, project!);
    await page.reload();
    const tasks = await page.evaluate(
      (project) => window.skaro.invoke('tasks.list', project),
      project!,
    );
    const live = tasks.filter((task) => !task.archived),
      archived = tasks.filter((task) => task.archived);
    const projection = await page.evaluate(async (project) => {
      const catalog = await window.skaro.invoke('plan.catalog', project);
      const entries = [];
      for (const archived of [false, true])
        for (const stage of catalog[archived ? 'archive' : 'plan']) {
          const source = await window.skaro.invoke('tasks.query', project, {
            kind: 'plan',
            milestones: [stage.milestone.id],
            archived,
          });
          const rows = [];
          for (let at = 0; at < source.count; at += 16) {
            const part = await window.skaro.invoke('tasks.page', source, at);
            if (part.length > 16) throw new Error('Unbounded plan page');
            rows.push(...part);
          }
          entries.push({ stage, archived, rows });
        }
      return entries;
    }, project!);
    for (const { stage, archived: isArchive, rows } of projection) {
      const own = tasks.filter((task) => (task.milestone?.id ?? '') === stage.milestone.id);
      const expected = own
        .filter((task) => !!task.archived === isArchive)
        .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0));
      expect(rows.map((row) => row.id)).toEqual(expected.map((task) => task.id));
      expect(stage.taskCount).toBe(expected.length);
      expect(stage.allCount).toBe(own.length);
      expect(stage.done).toBe(expected.filter((task) => task.status === 'done').length);
      expect(stage.total).toBe(expected.filter((task) => task.status !== 'cancelled').length);
      expect(stage.canDelete).toBe(
        own.every((task) => task.stage === 'todo' && ['todo', 'blocked'].includes(task.status)),
      );
      for (const row of rows)
        if (row.kind === 'task') {
          expect(new Set(row.dependencies?.map((link) => link.id))).toEqual(
            new Set(row.task.deps.filter((id) => tasks.some((task) => task.id === id))),
          );
          for (const link of row.dependencies ?? []) {
            const task = tasks.find((task) => task.id === link.id)!;
            expect(link).toEqual({ id: task.id, title: task.title, status: task.status });
          }
        }
    }
    const stages = page.locator('.stages[data-plan-screen] > .stage[data-plan-stage]');
    await expect(stages.first()).toBeVisible({ timeout: 30_000 });
    const liveIds = await stages
      .locator('[data-row]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-row')));
    expect(new Set(liveIds)).toEqual(new Set(live.map((task) => task.id)));
    await expect(page.locator('.screen[data-plan-screen]')).toContainText(live[0]!.title);
    const related = live.find((task) => live.some((other) => other.deps.includes(task.id)))!;
    expect(related).toBeDefined();
    const hoveredRow = stages.locator(`[data-row="${related.id}"]`);
    await hoveredRow.hover();
    await expect(hoveredRow).toHaveClass(/self/);
    await expect
      .poll(
        async () =>
          new Set(
            await stages
              .locator('[data-row].related')
              .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row'))),
          ),
      )
      .toEqual(
        new Set(
          live
            .filter((task) => related.deps.includes(task.id) || task.deps.includes(related.id))
            .map((task) => task.id),
        ),
      );
    // Keyboard drag must retain full group positions and cancel without writing task files.
    await hoveredRow.focus();
    await page.keyboard.press('Space');
    await expect(stages.locator('[data-rows] .slot')).toHaveCount(1);
    await expect(stages.locator(`[data-row="${related.id}"]`)).toHaveCount(0);
    const position = () =>
      stages
        .locator('[data-rows] .slot')
        .evaluate((slot) =>
          Number(slot.closest<HTMLElement>('[data-feed-block]')?.dataset['feedBlock']),
        );
    const origin = await position();
    await page.keyboard.press('ArrowDown');
    await expect(stages.locator('[data-rows] .slot')).toHaveCount(1);
    const siblings = live.filter((task) => task.milestone?.id === related.milestone?.id);
    expect(await position()).toBe(Math.min(siblings.length - 1, origin + 1));
    await page.keyboard.press('Escape');
    await expect(hoveredRow).toBeVisible();
    await expect(hoveredRow).toBeFocused();
    await expect(stages.locator('[data-rows] .slot')).toHaveCount(0);
    await expect(stages.locator('[data-row]')).toHaveCount(live.length);
    const owner = stages.filter({ has: page.locator(`[data-row="${related.id}"]`) });
    await owner.locator('.head .menu > button, .head .menu button.dots').click();
    const own = tasks.filter((task) => task.milestone?.id === related.milestone?.id);
    const canDelete = own.every(
      (task) => task.stage === 'todo' && (task.status === 'todo' || task.status === 'blocked'),
    );
    expect(
      await page
        .getByRole('menuitem', { name: 'Удалить этап…', exact: true })
        .getAttribute('aria-disabled'),
    ).toBe(canDelete ? null : 'true');
    const canArchive =
      siblings.length > 0 &&
      siblings.every((task) => task.status === 'done' || task.status === 'cancelled');
    expect(
      await page
        .getByRole('menuitem', { name: 'В архив', exact: true })
        .getAttribute('aria-disabled'),
    ).toBe(canArchive ? null : 'true');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('real-plan-on-demand.png') });
    const archive = page.locator('.tools[data-plan-screen] button[aria-pressed]');
    await archive.click();
    await expect(archive).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tools[data-plan-screen] button[data-tip="Развернуть все этапы"]').click();
    expect(await collectPlanRows(page.locator('.stages[data-plan-screen]'))).toEqual(
      new Set(archived.map((task) => task.id)),
    );
    expect(await stages.locator('[data-row]').count()).toBeLessThan(archived.length);
    await page.screenshot({ path: info.outputPath('real-plan-archive.png') });
    const group = projection.find(
      (entry) =>
        entry.archived &&
        entry.stage.milestone.id &&
        entry.stage.taskCount > 0 &&
        entry.stage.taskCount === entry.stage.allCount,
    )!.stage;
    try {
      await page.evaluate(
        ({ project, id }) => window.skaro.invoke('plan.archiveGroup', project, id, false),
        { project: project!, id: group.milestone.id },
      );
      await expect
        .poll(async () =>
          page.evaluate(
            async ({ project, id }) => {
              const result = await window.skaro.invoke('plan.catalog', project);
              return result.plan.find((stage) => stage.milestone.id === id)?.taskCount;
            },
            { project: project!, id: group.milestone.id },
          ),
        )
        .toBe(group.taskCount);
    } finally {
      await page.evaluate(
        ({ project, id }) => window.skaro.invoke('plan.archiveGroup', project, id, true),
        { project: project!, id: group.milestone.id },
      );
    }
    const restored = await page.evaluate(
      (project) => window.skaro.invoke('tasks.list', project),
      project!,
    );
    expect(restored.map((task) => [task.id, task.archived])).toEqual(
      tasks.map((task) => [task.id, task.archived]),
    );

    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await expect(page.locator('.chat[data-chat-screen]')).toBeVisible();
    await page.getByRole('navigation').getByText('План', { exact: true }).click();
    await expect(page.locator('.screen[data-plan-screen]')).toContainText(live[0]!.title);
    console.log('Real plan:', {
      live: live.length,
      archived: archived.length,
      renderedIds: liveIds.length,
    });
    expect(errors).toEqual([]);
  } finally {
    if (saved && !page.isClosed())
      await page.evaluate(async (saved) => {
        await window.skaro.invoke('tabs.set', saved.tabs);
        await window.skaro.invoke('app.setSetting', 'ui.workspace', saved.workspace);
      }, saved);
    await app.close();
  }
});
