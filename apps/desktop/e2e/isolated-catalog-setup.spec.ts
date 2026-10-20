import { expect, test } from '@playwright/test';
import { basename, dirname } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
test.skip(
  !profile || !root || process.env['SKARO_E2E_PREPARE_WRITE_PROJECT'] !== '1',
  'Requires explicit preparation of a separate writable test project',
);

test('creates and cancels actual chats in the separate project through the real backend', async () => {
  test.setTimeout(240_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const project = await page.evaluate(
      async ({ parent, name, root }) => {
        const existing = (await window.skaro.invoke('projects.list')).find((p) => p.path === root);
        const project = existing ?? (await window.skaro.invoke('projects.create', parent, name));
        await window.skaro.invoke('tabs.set', { projects: [project.id], active: project.id });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project.id]: 'chat' },
          openChats: {},
          openTasks: {},
        });
        return project;
      },
      { parent: dirname(root!), name: basename(root!), root: root! },
    );
    console.log('Separate test project:', JSON.stringify({ id: project.id, path: project.path }));
    await expect
      .poll(
        async () => {
          const agents = await page.evaluate(() => window.skaro.invoke('agents.list'));
          return agents.some(
            (agent) => agent.id === 'codex' && agent.installed && agent.authenticated,
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const existing = await page.evaluate((id) => window.skaro.invoke('chats.list', id), project.id);
    for (let index = existing.length; index < 66; index++) {
      const chat = await page.evaluate(
        async ({ project, index }) => {
          const chat = await window.skaro.invoke(
            'chat.create',
            project,
            { agent: 'codex', effort: 'low' },
            {
              text: `Проверка доставки сообщения. Отмена ${index + 1}. Не используй инструменты и не изменяй файлы.`,
            },
          );
          await window.skaro.invoke('chat.interrupt', project, chat.id);
          return chat;
        },
        { project: project.id, index },
      );
      console.log('Actual create/cancel:', index + 1, chat.id);
    }
    const chats = await page.evaluate((id) => window.skaro.invoke('chats.list', id), project.id);
    expect(chats.length).toBeGreaterThanOrEqual(66);
    expect(chats.every((chat) => !chat.live)).toBe(true);
  } finally {
    await app.close();
  }
});
