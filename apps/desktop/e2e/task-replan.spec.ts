import { AppDb, ArtifactStore, git } from '@skaro/core';
import { expect, test } from '@playwright/test';
import type { Item } from '@skaro/timeline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareTaskReplan } from '../src/main/task-replan-prepare';
import { taskBody } from '../src/main/task-body';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

test.skip(noAgents, noAgentsReason);

// Owner authorized isolated real records and native Electron; no agent session or fake API.
// eslint-disable-next-line no-empty-pattern
test('reviews and applies a whole replan once, rejects stale work and preserves it after restart', async ({}, testInfo) => {
  const userData = tempUserData();
  const root = join(userData, 'project');
  await mkdir(root);
  await git(root, ['init', '-q', '-b', 'main']);
  const store = new ArtifactStore(root);
  await store.writeDoc('brief.md', 'Проверка перепланирования не начатых задач.');
  const milestone = await store.createMilestone({ title: 'Обработка запроса' });
  const a = await store.createTask({
    title: 'Обработка',
    milestone: milestone.id,
    body: taskBody({ goal: 'Обработать запрос.', criteria: ['Запрос обрабатывается.'] }, 'ru'),
  });
  const b = await store.createTask({
    title: 'Документация',
    milestone: milestone.id,
    dependsOn: [a.id],
    body: taskBody({ goal: 'Документировать запрос.', criteria: ['Запрос документирован.'] }, 'ru'),
  });
  const c = await store.createTask({
    title: 'Использование',
    dependsOn: [b.id],
    body: taskBody({ goal: 'Использовать запрос.', criteria: ['Запрос используется.'] }, 'ru'),
  });
  const artifacts = await store.load();
  const proposal = prepareTaskReplan(
    {
      key: 'merge',
      title: 'Объединить обработку и документацию',
      taskIds: [a.id, b.id],
      tasks: [
        {
          ref: 'request',
          id: a.id,
          sources: [a.id, b.id],
          title: 'Обработать и документировать запрос',
          goal: 'Обработать запрос и документировать его.',
          criteria: ['Запрос обрабатывается.', 'Запрос документирован.'],
          milestone: milestone.id,
          order: 1,
          dependsOn: [],
        },
      ],
    },
    artifacts,
    'ru',
  );
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Перепланирование', path: root });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'Задачи',
    logPath: 'chats/replan.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const items: Item[] = ['merge', 'stale'].map((id, i) => ({
    id,
    kind: 'proposal',
    turnId: '',
    status: 'done',
    state: 'pending',
    startedAt: i + 1,
    native: { agent: 'skaro', type: 'proposal', ref: 'task_replan' },
    proposal: { ...proposal, key: id, title: i ? 'Альтернативный план' : proposal.title },
  }));
  items.push({
    id: 'old-reply',
    kind: 'message',
    role: 'agent',
    phase: 'final',
    text: 'Пока план не принят, задачи не изменены.',
    turnId: '',
    status: 'done',
    startedAt: 3,
    native: { agent: 'skaro', type: 'message', ref: '' },
  });
  await mkdir(join(userData, 'chats'));
  await writeFile(
    join(userData, chat.logPath),
    items
      .map((item) =>
        JSON.stringify({
          ts: item.startedAt,
          dir: 'meta',
          line: { skaro: 'event', event: { t: 'item.upsert', item } },
        }),
      )
      .join('\n') + '\n',
  );
  let app = await launchApp(userData);
  const errors: string[] = [];
  try {
    let page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    let card = page.locator('#proposal-merge');
    await expect(card.locator('.title')).toHaveText(proposal.title);
    await expect(card.getByRole('button', { name: 'Применить', exact: true })).toHaveCount(1);
    await page.locator('.feed-wrap > .scroller').hover();
    await page.mouse.wheel(0, -2000);
    await expect(card.locator('.title')).toBeInViewport();
    await card.screenshot({ path: testInfo.outputPath('replan-card.png'), animations: 'disabled' });
    await card.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Запрос документирован.');
    await page.screenshot({
      path: testInfo.outputPath('replan-viewer.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath('replan-before.png') });
    expect((await store.load()).tasks).toHaveLength(3);
    await card.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('Задачи перепланированы: 2 → 1');
    const appliedText = 'Перепланирование завершено. Задачи: 2 → 1.';
    await expect(page.getByText(appliedText, { exact: true })).toBeVisible();
    expect(
      await page
        .getByText('Пока план не принят, задачи не изменены.', { exact: true })
        .evaluate((old, text) => {
          const notice = [...document.querySelectorAll('.fd-notice')].find((e) =>
            e.textContent?.includes(text),
          );
          return (
            !!notice && !!(old.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
        }, appliedText),
    ).toBe(true);
    const after = (await store.load()).tasks;
    expect(after.map((t) => t.id)).toEqual([a.id, c.id]);
    expect(after[1]!.dependsOn).toEqual([a.id]);
    await page.screenshot({ path: testInfo.outputPath('replan-applied.png') });
    await card.getByRole('button', { name: 'Открыть задачи', exact: true }).click();
    await expect(
      page.locator('.board .card').filter({ hasText: proposal.tasks[0]!.title }),
    ).toBeVisible();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    card = page.locator('#proposal-merge');
    await page
      .locator('#proposal-stale')
      .getByRole('button', { name: 'Применить', exact: true })
      .click();
    await expect(page.getByText(/task graph changed after this proposal/i)).toBeVisible();
    await expect(
      page.locator('.fd-notice').filter({ hasText: 'Перепланирование «Альтернативный план»' }),
    ).toBeVisible();
    expect((await store.load()).tasks).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath('replan-failed.png') });
    await app.close();
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    card = page.locator('#proposal-merge');
    await expect(card.getByRole('status')).toHaveText('Задачи перепланированы: 2 → 1');
    await expect(page.getByText(appliedText, { exact: true })).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Применить', exact: true })).toHaveCount(0);
    expect((await store.load()).tasks).toEqual(after);
    await page.locator('.feed-wrap > .scroller').hover();
    await page.mouse.wheel(0, -2000);
    await expect(card.locator('.title')).toBeInViewport();
    await card.screenshot({
      path: testInfo.outputPath('replan-card-restored.png'),
      animations: 'disabled',
    });
    await page.screenshot({ path: testInfo.outputPath('replan-restored.png') });
    await card.getByRole('button', { name: 'Откатить', exact: true }).click();
    await expect(card.getByRole('status')).toHaveText('Исходные задачи восстановлены: 1 → 2');
    await expect(
      page.getByText('Перепланирование отменено. Восстановлено задач: 2.', { exact: true }),
    ).toBeVisible();
    expect((await store.load()).tasks).toEqual([a, b, c]);
    await card.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Запрос документирован.');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath('replan-reverted.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
