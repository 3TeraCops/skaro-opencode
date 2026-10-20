// Native Codex question in an existing task; the real command inbox and run log remain in use.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { AgentSettings, SkaroApi, TabsState, WorkspaceState } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_LAUNCH_PROJECT'];
const task = process.env['SKARO_LAUNCH_TASK'];
test.skip(!profile || !project || !task, 'Requires an existing task and real signed-in Codex');

test('keeps a real task question pinned through restart and resumes its native thread once', async ({
  browserName: _browserName,
}) => {
  test.setTimeout(180_000);
  const marker = `SKARO_TASK_ANSWER_${randomUUID().replaceAll('-', '')}`;
  let app = await launchApp(profile!, { openSavedProject: false });
  let page = await app.firstWindow();
  let previous: { tabs: TabsState; workspace: WorkspaceState; settings: AgentSettings } | undefined;
  try {
    previous = await page.evaluate(
      async ({ project, task }) => {
        const tabs = await window.skaro.invoke('tabs.get');
        const workspace = (await window.skaro.invoke(
          'app.getSetting',
          'ui.workspace',
        )) as WorkspaceState;
        const view = await window.skaro.invoke('task.open', project, task, { paged: true });
        await window.skaro.invoke('task.setSettings', project, task, {
          ...view.settings,
          agent: 'codex',
          permissionMode: 'full',
          planFirst: false,
        });
        await window.skaro.invoke('tabs.set', {
          projects: tabs.projects.includes(project) ? tabs.projects : [...tabs.projects, project],
          active: project,
        });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          ...workspace,
          view: 'project',
          sections: { ...workspace.sections, [project]: 'tasks' },
          openTasks: { ...workspace.openTasks, [project]: task },
        });
        return { tabs, workspace, settings: view.settings };
      },
      { project: project!, task: task! },
    );
    await page.reload();
    // Resolve only a previous failed run of this exact read-only check, never an owner question.
    const previousQuestion = await page.evaluate(
      async ({ project, task }) => {
        const view = await window.skaro.invoke('task.open', project, task, { paged: true });
        return view.timeline?.interactions.find((item) => item.kind === 'question');
      },
      { project: project!, task: task! },
    );
    if (previousQuestion?.kind === 'question') {
      expect(
        previousQuestion.questions.every((q) => q.text === 'Продолжить проверку задачи?'),
      ).toBe(true);
      await page.evaluate(
        async ({ project, task, question }) => {
          if (question.kind !== 'question') return;
          await window.skaro.invoke('task.respond', project, task, question.id, {
            kind: 'question',
            answers: Object.fromEntries(
              question.questions.map((q) => [q.id, ['Проверка завершена']]),
            ),
          });
        },
        { project: project!, task: task!, question: previousQuestion },
      );
      await expect
        .poll(
          async () =>
            (
              await page.evaluate(
                ({ project, task }) =>
                  window.skaro.invoke('task.open', project, task, { paged: true }),
                { project: project!, task: task! },
              )
            ).timeline?.status,
          { timeout: 60_000 },
        )
        .toBe('idle');
    }
    const input = page.locator('.task-conversation .composer textarea');
    await expect(input).toBeEnabled();
    await input.fill(
      'Проверка ожидания владельца. Не выполняй задачу и не читай или меняй файлы. ' +
        'Используй request_user_input_async с одним вопросом «Продолжить проверку задачи?» ' +
        'и вариантами «Проверка завершена» и «Оставить в ожидании». Дождись моего ответа. ' +
        `После ответа напиши только ${marker}. Не запускай инструменты, кроме вопроса.`,
    );
    await input.press('Enter');
    const question = page.locator('.task-conversation .fd-card.question');
    await expect(question).toBeVisible({ timeout: 90_000 });
    const pending = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      { project: project!, task: task! },
    );
    expect(pending.timeline!.status).toBe('waiting');
    expect(pending.timeline!.interactions.some((item) => item.kind === 'question')).toBe(true);
    expect(await question.evaluate((el) => !el.closest('.scroller'))).toBe(true);
    await app.close();
    app = await launchApp(profile!, { openSavedProject: false });
    page = await app.firstWindow();
    const restored = page.locator('.task-conversation .fd-card.question');
    await expect(restored).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.fd-text').filter({ hasText: marker })).toHaveCount(0);
    await restored.locator('.option').filter({ hasText: 'Проверка завершена' }).click();
    await restored.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(restored).toHaveCount(0);
    await expect(page.locator('.fd-text').filter({ hasText: marker })).toBeVisible({
      timeout: 60_000,
    });
    const answered = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      { project: project!, task: task! },
    );
    expect(answered.timeline!.session?.nativeSessionId).toBe(
      pending.timeline!.session?.nativeSessionId,
    );
    const questionId = pending.timeline!.interactions.find((item) => item.kind === 'question')!.id;
    const count = await page.evaluate(
      async ({ project, task, id }) => {
        const view = await window.skaro.invoke('task.open', project, task);
        return view.timeline!.items.filter(
          (item) => item.kind === 'decision' && item.interaction.id === id,
        ).length;
      },
      { project: project!, task: task!, id: questionId },
    );
    expect(count).toBe(1);
  } finally {
    await page
      .evaluate(({ project, task }) => window.skaro.invoke('tasks.cancel', project, task), {
        project: project!,
        task: task!,
      })
      .catch(() => undefined);
    if (previous)
      await page.evaluate(
        async ({ project, task, previous }) => {
          await window.skaro.invoke('task.setSettings', project, task, previous.settings);
          await window.skaro.invoke('tabs.set', previous.tabs);
          await window.skaro.invoke('app.setSetting', 'ui.workspace', previous.workspace);
        },
        { project: project!, task: task!, previous },
      );
    await app.close();
  }
});
