import { expect, test } from '@playwright/test';
import { AppDb, AttachmentStore } from '@skaro/core';
import { McpHttpServer, type SkaroScope } from '@skaro/mcp-server';
import type { TimelineEvent } from '@skaro/timeline';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentManager } from '../src/main/agents';
import { CompletionFixture } from '../src/main/completion-test-support';
import { TaskRuns } from '../src/main/tasks';
import { AUTO_MERGE_KEY, type SkaroApi } from '../src/shared/ipc';
import { launchApp, noAgents, noAgentsReason } from './launch';

declare const window: Window & { skaro: SkaroApi };
test.skip(noAgents, noAgentsReason);

test('the real merge card follows file edits and publishes matching untracked additions', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  const f = await CompletionFixture.create();
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  let runs: TaskRuns | undefined;
  try {
    f.db.setSetting(AUTO_MERGE_KEY, false);
    f.db.setSetting('ui.locale', 'ru');
    f.db.setSetting('ui.navCollapsed', false);
    const task = await f.task('Проверить слияние одинаковых файлов');
    await f.commit();
    const worktree = await f.checkout(task);
    await writeFile(join(worktree, 'feature.txt'), 'accepted result\n');
    await writeFile(join(f.repo, 'feature.txt'), 'owner edit\n');
    // Recorded test history makes the task feed visible; no agent process is started.
    const history: TimelineEvent[] = [
      { t: 'turn.started', turnId: 'accepted-turn' },
      {
        t: 'item.upsert',
        item: {
          id: 'request',
          turnId: 'accepted-turn',
          kind: 'message',
          role: 'user',
          text: 'Влей принятый результат',
          status: 'done',
          startedAt: Date.now(),
          native: { agent: 'skaro', type: 'user_message', ref: '' },
        },
      },
      { t: 'turn.completed', turnId: 'accepted-turn', outcome: 'done' },
    ];
    await mkdir(join(f.root, 'runs'));
    await writeFile(
      join(f.root, f.db.listRuns(f.projectId, task.id)[0]!.logPath),
      history
        .map((event) => JSON.stringify({ ts: 0, dir: 'meta', line: { skaro: 'event', event } }))
        .join('\n') + '\n',
    );
    runs = new TaskRuns({
      db: f.db,
      dataDir: f.root,
      projects: f.projects,
      agents: new AgentManager({
        agentsDir: process.env['SKARO_AGENTS_DIR']!,
        scratchDir: join(f.root, 'scratch'),
        store: {
          getSetting: (key) => f.db.getSetting(key, null),
          setSetting: (key, value) => f.db.setSetting(key, value),
        },
        openUrl: () => undefined,
        onChange: () => undefined,
      }),
      attachments: new AttachmentStore(join(f.root, 'attachments')),
      mcp: new McpHttpServer<SkaroScope>({ name: 'skaro', version: 'test', tools: [] }),
      emit: () => undefined,
      locale: () => 'ru',
    });
    await runs.open(f.projectId, task.id);
    const result = await runs.submitResult(
      {
        summary: 'Accepted result',
        commitMessage: 'merge matching files',
        criteria: [{ number: 1, met: true, evidence: 'Actual Git result' }],
      },
      {
        kind: 'task',
        projectId: f.projectId,
        taskId: task.id,
        runId: f.db.listRuns(f.projectId, task.id)[0]!.id,
      },
    );
    expect(result.isError).not.toBe(true);
    f.db.setOpenTabs([f.projectId], f.projectId);
    await runs.close();
    runs = undefined;
    await f.coordinator.close();
    f.projects.close();
    f.db.close();
    await copyFile(join(f.root, 'app.sqlite'), join(f.root, 'skaro.db'));
    f.db = AppDb.open(join(f.root, 'app.sqlite'));
    app = await launchApp(f.root);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await page.locator('.board .card').filter({ hasText: task.title }).click();
    const card = page.locator('.fd-merge-card');
    const merge = card.getByRole('button', { name: 'Влить', exact: true });
    await expect(card).toContainText('feature.txt');
    await expect(merge).toBeDisabled();
    // Repeated polling must not cache away later edits to the same path.
    await page.waitForTimeout(3_200);
    await writeFile(join(f.repo, 'feature.txt'), 'accepted result\n');
    await expect(merge).toBeEnabled({ timeout: 15_000 });
    await card.locator('textarea').fill('preserve this commit message');
    await writeFile(join(f.repo, 'feature.txt'), 'new owner edit\n');
    await expect(merge).toBeDisabled({ timeout: 15_000 });
    await writeFile(join(f.repo, 'feature.txt'), 'accepted result\n');
    await expect(merge).toBeEnabled({ timeout: 15_000 });
    await expect(card.locator('textarea')).toHaveValue('preserve this commit message');
    await page.screenshot({ path: testInfo.outputPath('matching-files-ready.png') });
    await merge.click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(
          ({ projectId, taskId }) =>
            window.skaro.invoke('task.open', projectId, taskId).then((view) => view.task.status),
          { projectId: f.projectId, taskId: task.id },
        ),
      )
      .toBe('done');
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await runs?.close();
    await f.close();
  }
});
