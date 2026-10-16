import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import { MIGRATIONS } from './migrations.ts';

describe('deleted task run boundaries', () => {
  it('keeps retired history but never selects or continues it for a replacement task', () => {
    const db = AppDb.open(':memory:');
    try {
      const project = db.addProject({ name: 'Lifecycle', path: '/lifecycle' });
      const input = {
        projectId: project.id,
        taskId: 'T-050',
        agent: 'codex',
        logPath: 'old.jsonl',
        adapterVersion: 'test',
      };
      const old = db.createRun(input);
      db.setRunSession(old.id, 'old-native-session');
      db.retireTaskRuns(project.id, input.taskId);
      expect(db.listRuns(project.id, input.taskId)).toEqual([]);
      expect(db.getRun(old.id)).toMatchObject({
        retiredAt: expect.any(Number),
        nativeSessionId: 'old-native-session',
        logPath: 'old.jsonl',
      });
      expect(() =>
        db.continueRun({ ...input, previousRunId: old.id }, 'task.settings', {}),
      ).toThrow('previous run');
      const replacement = db.createRun({ ...input, logPath: 'new.jsonl' });
      expect(db.listRuns(project.id, input.taskId).map((run) => run.id)).toEqual([replacement.id]);
      expect(replacement.nativeSessionId).toBeUndefined();
      expect(db.listRuns(project.id, input.taskId, { includeRetired: true })).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('migrates legacy deletion events without retiring a later legitimate run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-deleted-runs-'));
    const path = join(directory, 'skaro.db');
    try {
      const legacy = new DatabaseSync(path);
      for (const migration of MIGRATIONS.slice(0, -1)) legacy.exec(migration);
      legacy.exec(`PRAGMA user_version = 4;
        INSERT INTO projects(id,name,path,created_at) VALUES ('p','Lifecycle','/lifecycle',0);
        INSERT INTO runs(id,project_id,task_id,agent,log_path,adapter_version,started_at,native_session_id)
          VALUES ('old','p','T-050','codex','old.jsonl','test',100,'old-native');
        INSERT INTO events(project_id,kind,data,at) VALUES ('p','task_deleted','{"task":"T-050"}',200);
        INSERT INTO runs(id,project_id,task_id,agent,log_path,adapter_version,started_at)
          VALUES ('new','p','T-050','codex','new.jsonl','test',300);
        INSERT INTO task_runtime(project_id,task_id,state,run_id,updated_at) VALUES ('p','T-050','waiting','old',400);`);
      legacy.close();
      const db = AppDb.open(path);
      try {
        expect(db.listRuns('p', 'T-050').map((run) => run.id)).toEqual(['new']);
        expect(db.getRun('old')).toMatchObject({
          retiredAt: 200,
          nativeSessionId: 'old-native',
          endedAt: 200,
        });
        expect(db.getTaskRuntime('p').size).toBe(0);
        expect(db.usedTaskIds('p')).toEqual(['T-050']);
      } finally {
        db.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
