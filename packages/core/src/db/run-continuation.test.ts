import { afterEach, beforeEach, expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

let db: AppDb;
beforeEach(() => {
  db = AppDb.open(':memory:');
});
afterEach(() => db.close());

it('publishes a continuation and its settings atomically while preserving the checkout and original session', () => {
  const project = db.addProject({ name: 'Handoff', path: '/handoff' });
  const input = {
    projectId: project.id,
    taskId: 'M06',
    agent: 'claude-code',
    worktree: '/worktrees/M06',
    branch: 'skaro/M06',
    logPath: 'claude.jsonl',
    adapterVersion: '1',
  };
  const first = db.createRun(input);
  db.setRunSession(first.id, 'claude-native');
  db.setSetting('agent.handoff', { from: first.id });
  const second = db.continueRun(
    {
      ...input,
      agent: 'codex',
      logPath: 'codex.jsonl',
      previousRunId: first.id,
      handoff: 'saved context',
    },
    'agent',
    { agent: 'codex' },
  );
  expect(second).toMatchObject({
    previousRunId: first.id,
    agent: 'codex',
    worktree: input.worktree,
    branch: input.branch,
    handoff: 'saved context',
  });
  expect(second.nativeSessionId).toBeUndefined();
  expect(db.getRun(first.id)).toMatchObject({
    agent: 'claude-code',
    nativeSessionId: 'claude-native',
    logPath: 'claude.jsonl',
    outcome: 'interrupted',
  });
  expect(db.getSetting('agent', null)).toEqual({ agent: 'codex' });
  expect(db.getSetting('agent.handoff', null)).toBeNull();
  const third = db.continueRun(
    { ...input, previousRunId: second.id, logPath: 'claude-next.jsonl' },
    'agent',
    { agent: 'claude-code' },
  );
  expect(third.nativeSessionId).toBeUndefined();
  expect(db.listRuns(project.id, 'M06').map((r) => r.id)).toEqual([third.id, second.id, first.id]);
});

it('rejects a duplicate or foreign predecessor without consuming the recovery intent', () => {
  const project = db.addProject({ name: 'Handoff', path: '/handoff' });
  const input = {
    projectId: project.id,
    taskId: 'T-1',
    agent: 'claude-code',
    logPath: 'first.jsonl',
    adapterVersion: '1',
  };
  const first = db.createRun(input);
  const next = { ...input, agent: 'codex', logPath: 'next.jsonl', previousRunId: first.id };
  db.setSetting('agent.handoff', { from: first.id });
  expect(() => db.continueRun({ ...next, taskId: 'T-2' }, 'agent', {})).toThrow('does not belong');
  expect(db.getRun(first.id)?.endedAt).toBeUndefined();
  expect(db.getSetting('agent.handoff', null)).toEqual({ from: first.id });
  db.continueRun(next, 'agent', { agent: 'codex' });
  db.setSetting('agent.handoff', { from: first.id });
  expect(() => db.continueRun(next, 'agent', {})).toThrow('another run');
  expect(db.listRuns(project.id)).toHaveLength(2);
  expect(db.getSetting('agent', null)).toEqual({ agent: 'codex' });
  expect(db.getSetting('agent.handoff', null)).toEqual({ from: first.id });
});
