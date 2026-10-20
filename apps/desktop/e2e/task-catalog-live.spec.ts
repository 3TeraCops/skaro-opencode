// Read only the task files/runtime of the isolated real profile through the actual backend.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { activeKind, boardStatus, needsYou, taskMatches } from '../src/shared/task-presentation';
import type { TaskEntry, TaskQuery, TaskRange } from '../src/shared/task-catalog';
import type { SkaroApi } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires an isolated existing real project with archived tasks');

test('queries real tasks in bounded pages and preserves counts, filtering, archive access and selection', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.project-nav')).toBeVisible({ timeout: 30_000 });
    const canonical = await page.evaluate(
      (project) => window.skaro.invoke('tasks.list', project),
      project!,
    );
    const live = canonical.filter((task) => !task.archived);
    const archived = canonical.filter((task) => task.archived);
    expect(archived.length).toBeGreaterThan(32);
    const catalog = await page.evaluate(
      (project) => window.skaro.invoke('tasks.catalog', project),
      project!,
    );
    expect(catalog.facets.total).toBe(live.length);
    expect(catalog.facets.working).toBe(
      live.filter((task) => task.status === 'in_progress').length,
    );
    expect(catalog.facets.attention).toBe(live.filter(needsYou).length);
    const query = (value: TaskQuery) =>
      page.evaluate(({ project, value }) => window.skaro.invoke('tasks.query', project, value), {
        project: project!,
        value,
      });
    async function read(source: TaskRange) {
      const entries: TaskEntry[] = [];
      for (let start = 0; start < source.count; start += 16) {
        const part = await page.evaluate(
          ({ source, start }) => window.skaro.invoke('tasks.page', source, start),
          { source, start },
        );
        expect(part.length).toBeLessThanOrEqual(16);
        part.forEach((entry, index) => expect(entry.index).toBe(start + index));
        entries.push(...part);
      }
      return entries;
    }
    const candidates: TaskQuery[] = [
      {},
      { archived: true },
      { statuses: [boardStatus(live[0]!.status)] },
      { milestones: [live[0]!.milestone?.id ?? ''] },
      { agents: [live[0]!.agent ?? 'none'] },
      { query: live[0]!.id.toLowerCase() },
      { query: live[0]!.title.slice(0, 8).toUpperCase() },
    ];
    for (const candidate of candidates) {
      const source = await query(candidate),
        expected = canonical.filter((task) => taskMatches(task, candidate));
      expect(source.count).toBe(expected.length);
      expect(source.done).toBe(expected.filter((task) => task.status === 'done').length);
      expect((await read(source)).map((entry) => entry.id)).toEqual(
        expected.map((task) => task.id),
      );
    }
    const archivedSource = await query({ archived: true });
    const last = archived.at(-1)!;
    expect(
      await page.evaluate(({ source, id }) => window.skaro.invoke('tasks.find', source, id), {
        source: archivedSource,
        id: last.id,
      }),
    ).toBe(archived.length - 1);
    const list = await read(await query({ kind: 'list' }));
    const milestones = catalog.milestones;
    const groups = [
      ...milestones,
      ...(live.some((task) => !task.milestone) ? [{ id: '', title: '', order: 0 }] : []),
    ]
      .map((milestone) => ({
        milestone,
        tasks: live.filter((task) => (task.milestone?.id ?? '') === milestone.id),
      }))
      .filter((group) => group.tasks.length);
    expect(list.map((entry) => entry.id)).toEqual(
      groups.flatMap((group) => [
        `group:${group.milestone.id}`,
        ...group.tasks.map((task) => task.id),
      ]),
    );
    for (const group of groups) {
      const rows = list.filter(
        (entry) => entry.kind === 'task' && (entry.task.milestone?.id ?? '') === group.milestone.id,
      );
      const first = rows[0],
        last = rows.at(-1);
      expect(first?.kind === 'task' && first.first).toBe(true);
      expect(last?.kind === 'task' && last.last).toBe(true);
    }
    const active = await read(catalog.active);
    const rank = { need: 0, review: 1, working: 2 };
    expect(active.map((entry) => entry.id)).toEqual(
      live
        .filter((task) => activeKind(task))
        .toSorted((a, b) => rank[activeKind(a)!] - rank[activeKind(b)!])
        .map((task) => task.id),
    );
    const chosen = await page.evaluate(
      (source) => window.skaro.invoke('tasks.select', source),
      await query({}),
    );
    expect(new Set(chosen.map((task) => task.id))).toEqual(new Set(live.map((task) => task.id)));
    // Real archive queries exceed the range-cache budget; old descriptors must remain usable.
    for (const task of archived.slice(0, 65)) await query({ archived: true, query: task.id });
    expect((await read(archivedSource)).map((entry) => entry.id)).toEqual(
      archived.map((task) => task.id),
    );
    await page.screenshot({ path: info.outputPath('real-task-catalog.png') });
    console.log('Real task catalog:', {
      total: canonical.length,
      live: live.length,
      archived: archived.length,
      pageSize: 16,
      active: active.length,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
