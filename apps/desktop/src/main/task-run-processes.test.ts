import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { TaskRunProcesses } from './task-run-processes';

let root: string;
let db: AppDb;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-processes-test-'));
  db = AppDb.open(join(root, 'app.sqlite'));
});
afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

// PID 4 is the Windows kernel process: it always runs and hides its start time from a user.
it.runIf(process.platform === 'win32')(
  'forgets a recorded PID now held by a process whose start time cannot be read',
  async () => {
    const key = 'run.verification-old.processes';
    db.setSetting(key, [{ pid: 4, birth: '1', platform: 'win32' }]);
    await new TaskRunProcesses(db).stop('verification-old');
    expect(db.getSetting(key, null)).toEqual([]);
  },
  30_000,
);
