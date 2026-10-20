// Existing profile, installed pinned CLIs and real native metadata; no mocked transport.
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !projectId, 'Requires an isolated copy of a real project profile');

test('checks CLI accounts and reads Claude SDK metadata through the real backend', async () => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(
        async () => {
          const agents = await page.evaluate(() => window.skaro.invoke('agents.list'));
          return agents.every((agent) => !agent.checking);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const agents = await page.evaluate(() => window.skaro.invoke('agents.refresh'));
    for (const id of ['claude-code', 'codex']) {
      const agent = agents.find((agent) => agent.id === id)!;
      expect(agent.installed).toBe(true);
      expect(agent.error).toBeUndefined();
      console.log(
        'Real CLI account:',
        JSON.stringify({
          id: agent.id,
          installed: agent.installed,
          authenticated: agent.authenticated,
        }),
      );
    }
    const sdkLoaded = () =>
      app.evaluate(() =>
        Object.keys(
          (process.getBuiltinModule('module') as typeof import('node:module')).createRequire(
            process.execPath,
          ).cache,
        ).some((path) => /[/\\]sdk-[^/\\]+\.js$/.test(path)),
      );
    expect(await sdkLoaded()).toBe(false);
    const models = await page.evaluate(
      (project) => window.skaro.invoke('agents.models', 'claude-code', project),
      projectId!,
    );
    expect(await sdkLoaded()).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((model) => model.isDefault)).toBe(true);
    expect(models.every((model) => model.id && model.name && Array.isArray(model.efforts))).toBe(
      true,
    );
    const commands = await page.evaluate(
      (project) => window.skaro.invoke('agents.commands', 'claude-code', project),
      projectId!,
    );
    expect(commands.length).toBeGreaterThan(0);
    expect(
      commands.every((command) => command.name && ['command', 'skill'].includes(command.kind)),
    ).toBe(true);
    console.log(
      'Real Claude SDK metadata:',
      JSON.stringify({ models: models.length, commands: commands.length }),
    );
    const refreshed = await page.evaluate(() => window.skaro.invoke('agents.refresh'));
    expect(refreshed.find((agent) => agent.id === 'claude-code')?.installed).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('starts a real Claude session in the native worker after splitting SDK dependencies', async () => {
  test.setTimeout(150_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const agents = await page.evaluate(() => window.skaro.invoke('agents.refresh'));
    test.skip(
      !agents.find((agent) => agent.id === 'claude-code')?.authenticated,
      'Requires the owner’s existing signed-in Claude account',
    );
    const marker = `SKARO_CLAUDE_BOUNDARY_${Date.now()}`;
    const chat = await page.evaluate(
      ({ projectId, marker }) =>
        window.skaro.invoke(
          'chat.create',
          projectId,
          { agent: 'claude-code', effort: 'low', permissionMode: 'full' },
          {
            text: `Проверка доставки. Ответь только ${marker}. Не используй инструменты, не читай и не изменяй файлы или документы проекта.`,
          },
        ),
      { projectId: projectId!, marker },
    );
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, projectId!, chat.id)).click();
    await expect(page.locator('.fd-text').filter({ hasText: marker })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 30_000 });
    await page.evaluate(
      ({ projectId, chatId }) => window.skaro.invoke('chat.archive', projectId, chatId, true),
      { projectId: projectId!, chatId: chat.id },
    );
  } finally {
    await app.close();
  }
});

test('reads the current real Codex quota before retrying generation', async () => {
  test.setTimeout(60_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const limits = await page.evaluate(() => window.skaro.invoke('agents.limits', 'codex'));
    expect(Number.isFinite(Date.parse(limits.checkedAt))).toBe(true);
    console.log('Current real Codex quota:', JSON.stringify(limits));
    const models = await page.evaluate(
      (project) => window.skaro.invoke('agents.models', 'codex', project),
      projectId!,
    );
    console.log('Codex native default model:', models.find((model) => model.isDefault)?.id);
  } finally {
    await app.close();
  }
});
