import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi, AgentId } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const root = process.env.SKARO_C4_VERIFY_ROOT;
const agent = process.env.SKARO_C4_VERIFY_AGENT as AgentId | undefined;
test.skip(!root || !agent, 'Opt-in: real checkout and an installed authenticated agent');

test('real agent proposes one C4 package through MCP and the owner decision survives restart', async () => {
  test.setTimeout(600_000);
  const profile = join(root!, 'output/c4-profile');
  const modelPath = join(root!, '.skaro/c4/model.json');
  const before = await readFile(modelPath, 'utf8');
  const revision = (JSON.parse(before) as { revision: number }).revision;
  let app = await launchApp(profile);
  try {
    let page = await app.firstWindow();
    await page.waitForFunction(() => !!window.skaro);
    const project = await page.evaluate((path) => window.skaro.invoke('projects.add', path), root!);
    await page.evaluate(async (projectId) => {
      await window.skaro.invoke('tabs.set', { projects: [projectId], active: projectId });
      await window.skaro.invoke('app.setLocale', 'ru');
    }, project.id);
    await page.reload();
    await page.locator('.project-nav').getByRole('button', { name: /^Чат/ }).click();
    const chat = await page.evaluate(
      ({ projectId, agent, verification }) =>
        window.skaro.invoke(
          'chat.create',
          projectId,
          { agent, effort: 'low', permissionMode: 'full' },
          {
            text:
              `${verification}\nПроверяем штатный процесс C4 на реальной документации Skaro. Не меняй код и файлы самостоятельно. ` +
              'Вызови get_c4_context. Предложи через propose_c4 ровно один пакет с title "C4 Skaro — согласование", ' +
              'summary "Проверка согласованного принятия текущей документации Skaro", documents: []. ' +
              'Сохрани модель полностью без изменения архитектурного смысла и покрытия требований; увеличь только revision на 1. ' +
              'base_revision возьми из контекста. Передай полный model в инструмент. Никаких shell-команд, новых задач или других предложений. ' +
              'Когда инструмент подтвердит сохранение пакета для владельца, закончи ответ. Не применяй пакет.',
          },
        ),
      { projectId: project.id, agent: agent!, verification: `C4 release 2.1.0 · ${Date.now()}` },
    );
    await page.locator('.sessions .row').filter({ hasText: chat.title }).click();
    const proposal = page.locator('.proposal').filter({ hasText: 'C4 Skaro — согласование' });
    await expect(proposal.getByRole('button', { name: 'Применить', exact: true })).toBeVisible({
      timeout: 420_000,
    });
    expect(await readFile(modelPath, 'utf8')).toBe(before);
    await proposal.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.viewer [data-c4-preview="containers"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press('Escape');
    await proposal.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect
      .poll(
        async () =>
          (JSON.parse(await readFile(modelPath, 'utf8')) as { revision: number }).revision,
      )
      .toBe(revision + 1);
    await expect(proposal.getByRole('button', { name: 'Применить', exact: true })).toHaveCount(0);
    await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 120_000 });
    await app.close();
    app = await launchApp(profile);
    page = await app.firstWindow();
    const restored = await page.evaluate(
      ({ projectId, chatId }) => window.skaro.invoke('chat.open', projectId, chatId),
      { projectId: project.id, chatId: chat.id },
    );
    const item = restored.timeline.items.find(
      (item) => item.kind === 'proposal' && item.proposal.type === 'architecture',
    );
    expect(item && item.kind === 'proposal' && item.state).toBe('applied');
    expect((JSON.parse(await readFile(modelPath, 'utf8')) as { revision: number }).revision).toBe(
      revision + 1,
    );
  } finally {
    await app.close();
  }
});
