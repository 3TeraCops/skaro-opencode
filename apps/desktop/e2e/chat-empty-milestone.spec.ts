import { AppDb, ArtifactStore } from '@skaro/core';
import { expect, test } from '@playwright/test';
import type { Item } from '@skaro/timeline';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

test.skip(noAgents, noAgentsReason);

test('accepts a roadmap milestone in the real chat without preparation tasks', async ({
  browserName: _browserName,
}, testInfo) => {
  // Owner-authorized regression data; all reads, replay and mutations use the actual backend.
  const userData = tempUserData();
  const root = join(userData, 'project');
  mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, windowsHide: true });
  const store = new ArtifactStore(root);
  await store.writeDoc('brief.md', 'Проект регрессионной проверки создания пустого этапа.');
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Проверка плана', path: root });
  const chat = db.createChat({
    projectId: project.id,
    agent: 'codex',
    title: 'План этапа',
    logPath: 'chats/roadmap.jsonl',
  });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const item: Extract<Item, { kind: 'proposal' }> = {
    id: 'empty-milestone',
    kind: 'proposal',
    turnId: '',
    state: 'pending',
    status: 'done',
    startedAt: Date.now(),
    native: { agent: 'skaro', type: 'proposal', ref: 'plan' },
    proposal: {
      type: 'plan',
      milestone: { id: 'M01', title: 'ИИ-черновик ответа оператору', isNew: true },
      tasks: [],
    },
  };
  mkdirSync(join(userData, 'chats'));
  writeFileSync(
    join(userData, chat.logPath),
    JSON.stringify({
      ts: 0,
      dir: 'meta',
      line: { skaro: 'event', event: { t: 'item.upsert', item } },
    }) + '\n',
  );

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    const card = page.locator('#proposal-empty-milestone');
    await expect(card.locator('.title')).toHaveText('Этап M01 «ИИ-черновик ответа оператору»');
    await expect(card.locator('.tasks')).toHaveCount(0);
    await expect(card.locator('.hint')).toHaveText('');
    await expect(card.getByRole('button', { name: 'Принять', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('empty-milestone-pending.png') });
    const changedToggle = page.getByRole('button', { name: 'Изменено в чате', exact: true });
    if ((await changedToggle.getAttribute('aria-pressed')) !== 'true') await changedToggle.click();
    await expect(page.locator('.changed-note')).toHaveText('Ждёт решения');
    await card.getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(card.locator('.line-text')).toHaveText(
      'Создан этап M01 «ИИ-черновик ответа оператору»',
    );
    await expect(page.locator('.changed-note')).toHaveText('Этап создан');
    const artifacts = await store.load();
    expect(artifacts.milestones.map((m) => m.id)).toEqual(['M01']);
    expect(artifacts.tasks).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('empty-milestone-applied.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
