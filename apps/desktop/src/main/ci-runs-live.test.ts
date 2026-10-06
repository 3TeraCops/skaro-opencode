import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CiRuns, type TrackedCiRun } from './ci-runs';
import { CompletionFixture } from './completion-test-support';

const origin = process.env['SKARO_CI_REAL_ORIGIN'];
const runId = Number(process.env['SKARO_CI_REAL_RUN']);
let fixture: CompletionFixture | undefined;
let ci: CiRuns | undefined;
beforeEach(async () => {
  if (!origin || !Number.isSafeInteger(runId) || runId <= 0) return;
  fixture = await CompletionFixture.create();
  await fixture.commit();
  await git(fixture.repo, ['remote', 'add', 'origin', origin]);
});
afterEach(async () => {
  await ci?.close();
  ci = undefined;
  await fixture?.close();
  fixture = undefined;
});

it.skipIf(!origin || !Number.isSafeInteger(runId) || runId <= 0)(
  'tracks a real completed GitHub run across SQLite restart and never retries success',
  async () => {
    const current = fixture!;
    const task = await current.task('Completed before CI');
    await current.commit();
    await current.accept(task, await current.checkout(task));
    await current.coordinator.merge(current.projectId, task.id);
    const scope = { kind: 'project_chat' as const, projectId: current.projectId };
    ci = new CiRuns(current.db, current.projects, async () => undefined);
    const result = await ci.call({ action: 'track', kind: 'release', runId }, scope);
    expect(result.isError).not.toBe(true);
    const record = current.db.getSetting<TrackedCiRun[]>('ci.runs', [])[0]!;
    expect(record.remote).toMatchObject({ id: runId, status: 'completed', conclusion: 'success' });
    // The assertion above ensures this request cannot trigger a remote rerun.
    const rejected = await ci.call({ action: 'retry_failed', kind: 'release', runId }, scope);
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain('Only a completed unsuccessful workflow');
    expect(
      current.db.getSetting<TrackedCiRun[]>('ci.runs', [])[0]?.retryRequestedAt,
    ).toBeUndefined();
    await ci.close();
    ci = undefined;
    await current.restart();
    ci = new CiRuns(current.db, current.projects, async () => undefined);
    await expect
      .poll(() => current.db.getSetting<TrackedCiRun[]>('ci.runs', [])[0]?.error, {
        timeout: 20_000,
      })
      .toBeUndefined();
    const status = await ci.call({ action: 'status', kind: 'release', runId }, scope);
    expect(status.isError).not.toBe(true);
    expect((await current.context.store.readTask(task.id)).status).toBe('done');
    expect(current.db.getSetting<TrackedCiRun[]>('ci.runs', [])[0]?.remote?.id).toBe(runId);
  },
  60_000,
);
