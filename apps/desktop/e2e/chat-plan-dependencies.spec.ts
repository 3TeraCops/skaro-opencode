import { AppDb, ArtifactStore } from '@skaro/core';
import { expect, test } from '@playwright/test';
import type { Item } from '@skaro/timeline';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

test.skip(noAgents, noAgentsReason);

// Playwright requires destructuring its first parameter even for Electron-only tests.
// eslint-disable-next-line no-empty-pattern
test('confirms the complete legacy plan once and preserves the result after restart', async ({}, testInfo) => {
  // Owner-authorized isolated records. Real SQLite, artifacts, replay, IPC and Electron renderer.
  const userData = tempUserData();
  const root = join(userData, 'project');
  mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, windowsHide: true });
  const store = new ArtifactStore(root);
  await store.writeDoc('brief.md', 'Проверка принятия задач с зависимостями.');
  const milestone = await store.createMilestone({ title: 'ИИ-черновик ответа оператору' });
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Проверка зависимостей', path: root });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'План задач',
    logPath: 'chats/dependencies.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const task = (ref: string, title: string, dependsOn: string[] = []) => ({
    ref,
    title,
    body: `## Цель\n\n${title}`,
    dependsOn,
    dependsOnTitles: dependsOn.map(() => 'Защитить внутренние записи'),
  });
  const items: Extract<Item, { kind: 'proposal' }>[] = [
    {
      id: 'dependent',
      kind: 'proposal',
      turnId: '',
      state: 'pending',
      status: 'done',
      startedAt: 1,
      native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
      proposal: {
        type: 'plan',
        milestone: { id: milestone.id, title: milestone.title, isNew: false },
        tasks: [
          task('setting', 'Настроить помощь оператору'),
          task('draft', 'Создавать черновик ответа', ['privacy']),
          task('optional', 'Дополнительная настройка'),
        ],
      },
    },
    {
      id: 'predecessor',
      kind: 'proposal',
      turnId: '',
      state: 'pending',
      status: 'done',
      startedAt: 2,
      native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
      proposal: { type: 'plan', tasks: [task('privacy', 'Защитить внутренние записи')] },
    },
  ];
  mkdirSync(join(userData, 'chats'));
  writeFileSync(
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
    let card = page.locator('#proposal-dependent');
    await expect(page.locator('.proposal .card')).toHaveCount(1);
    await expect(card.getByRole('checkbox')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
    await card.getByRole('checkbox', { name: /Дополнительная настройка/ }).click();
    await card.getByRole('checkbox', { name: /^Защитить внутренние записи/ }).click();
    await expect(
      card.getByRole('checkbox', { name: /^Создавать черновик ответа/ }),
    ).not.toBeChecked();
    await card.getByRole('checkbox', { name: /^Создавать черновик ответа/ }).click();
    await expect(card.getByRole('checkbox', { name: /^Защитить внутренние записи/ })).toBeChecked();
    const changed = page.getByRole('button', { name: 'Изменено в чате', exact: true });
    if ((await changed.getAttribute('aria-pressed')) !== 'true') await changed.click();
    await expect(page.locator('.changed-row')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('complete-plan.png') });
    await card.getByRole('button', { name: 'Подтвердить план', exact: true }).click();
    await expect(card.locator('.line-text')).toContainText('Созданы 3 задачи');
    await expect(page.getByRole('button', { name: 'Подтвердить план', exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('.changed-note')).toHaveText('Задачи созданы');
    await page.screenshot({ path: testInfo.outputPath('created.png') });
    await app.close();
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    card = page.locator('#proposal-dependent');
    await expect(card.locator('.line-text')).toContainText('Созданы 3 задачи');
    const tasks = (await store.load()).tasks;
    expect(tasks).toHaveLength(3);
    expect(tasks.find((t) => t.title === 'Создавать черновик ответа')!.dependsOn).toEqual([
      tasks.find((t) => t.title === 'Защитить внутренние записи')!.id,
    ]);
    await page.screenshot({ path: testInfo.outputPath('created.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
