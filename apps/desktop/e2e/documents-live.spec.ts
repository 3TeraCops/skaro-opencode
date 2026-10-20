// The real architecture and specifications in the copied profile, with the actual backend.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(
  !profile || !project,
  'Requires the existing large documents in an isolated real profile',
);

test('pages the real document catalog and renders a large document without mounting its whole body', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let previous: { tabs: TabsState; workspace: WorkspaceState; selected: string | null } | undefined;
  try {
    previous = await page.evaluate(async (project) => {
      const tabs = await window.skaro.invoke('tabs.get');
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      const selected = localStorage.getItem(`skaro.doc.${project}`);
      localStorage.setItem(`skaro.doc.${project}`, '.skaro/architecture.md');
      await window.skaro.invoke('tabs.set', {
        projects: tabs.projects.includes(project) ? tabs.projects : [...tabs.projects, project],
        active: project,
      });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: 'docs' },
      });
      return { tabs, workspace, selected };
    }, project!);
    await page.reload();
    const body = page.locator('[data-doc-article].blocks');
    await expect(body.locator('.md').first()).toBeVisible({ timeout: 90_000 });
    const actual = await page.evaluate(async (project) => {
      const catalog = await window.skaro.invoke('docs.catalog', project);
      const first = await window.skaro.invoke('docs.page', project, 'spec', 0);
      const last = await window.skaro.invoke(
        'docs.page',
        project,
        'spec',
        Math.max(0, catalog.counts.spec - 1),
      );
      const text = await window.skaro.invoke('docs.read', project, '.skaro/architecture.md');
      return { catalog, first, last, text };
    }, project!);
    expect(actual.catalog.counts.spec).toBeGreaterThan(16);
    expect(actual.first.length).toBeLessThanOrEqual(16);
    expect(actual.last).toHaveLength(1);
    expect(actual.text.length).toBeGreaterThan(100_000);
    const written = await page.evaluate(
      async ({ project, path }) => {
        const before = await window.skaro.invoke('docs.read', project, path);
        await window.skaro.invoke('docs.write', project, path, before);
        return (await window.skaro.invoke('docs.read', project, path)) === before;
      },
      { project: project!, path: actual.last[0]!.path },
    );
    expect(written, 'Exact document body preserved after a real unchanged save').toBe(true);
    const mounted = body.locator('.windowed-content > [data-feed-block]');
    await expect.poll(() => mounted.count()).toBeLessThan(60);
    console.log(
      'Document geometry:',
      await page.evaluate(() =>
        [
          '[data-doc-page].page',
          '[data-doc-page] article',
          '[data-doc-article].blocks',
          '.windowed-content',
          '[data-doc-article].md',
        ].map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return { selector, x: rect.x, width: rect.width, scrollWidth: element.scrollWidth };
        }),
      ),
    );
    await page.screenshot({ path: info.outputPath('real-document-paged.png') });
    const toc = page.locator('[data-doc-page] .toc-item');
    if (!(await toc.count()))
      await page.getByRole('button', { name: 'На странице', exact: true }).click();
    const last = toc.last();
    const title = await last.innerText();
    await last.click();
    await expect(body.locator('h2').filter({ hasText: title }).last()).toBeVisible();
    await body.locator('h2').last().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(actual.text);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const editor = page.locator('textarea[data-doc-editor]');
    await expect(editor).toHaveValue(actual.text);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    console.log('Real document:', {
      characters: actual.text.length,
      catalog: actual.catalog.counts,
      mounted: await mounted.count(),
    });
    expect(errors).toEqual([]);
  } finally {
    if (previous)
      await page.evaluate(
        async ({ previous, project }) => {
          await window.skaro.invoke('tabs.set', previous.tabs);
          await window.skaro.invoke('app.setSetting', 'ui.workspace', previous.workspace);
          if (previous.selected === null) localStorage.removeItem(`skaro.doc.${project}`);
          else localStorage.setItem(`skaro.doc.${project}`, previous.selected);
        },
        { previous, project: project! },
      );
    await app.close();
  }
});
