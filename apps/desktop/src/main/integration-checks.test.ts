import { expect, it } from 'vitest';
import type { IntegrationOperation } from './integration-model';
import { integrationChecks, reviseIntegrationChecks } from './integration-checks';
import { integrationFailure } from './integration-failure';
import { recoverLegacyCheckShell } from './integration-shell-recovery';
import { readVerificationPlan } from '../../../../packages/mcp-server/src/verification-plan';

const old = { name: 'Ruff', run: '$files = Get-ChildItem *.py; ruff check @files' };
const build = { name: 'Build', run: 'docker compose build backend-admin' };
const regression = { name: 'Regression', run: 'pytest affected' };

function operation(): IntegrationOperation {
  // Pure planner inputs; no repository, database, services or generated test data.
  return {
    id: 'candidate',
    projectId: 'project',
    taskId: 'T-068',
    purpose: 'dependencies',
    base: 'main',
    baseHead: 'base',
    head: 'candidate',
    fingerprint: 'inputs',
    worktree: process.cwd(),
    checks: [build],
    results: [
      {
        taskId: 'T-067',
        branch: 'accepted',
        head: 'accepted',
        criteria: 'criteria',
        message: 'Accepted',
        verification: [old],
      },
    ],
    conflicts: [],
    cursor: 1,
    state: 'failed',
    attempts: 3,
    needsVerification: true,
    sequence: 0,
    updatedAt: 0,
  };
}

it('replaces the exact inherited command and retains regression coverage across retries', () => {
  const op = operation();
  op.verificationPlan = [build, old, regression];
  const original = JSON.stringify(op.results);
  const corrected = { ...old, run: 'ruff check template_access.py', replaces: old.run };
  const revised = reviseIntegrationChecks(op, [corrected]);
  expect(revised.plan).toEqual([build, { name: old.name, run: corrected.run }, regression]);
  const saved = JSON.parse(
    JSON.stringify({
      ...op,
      checkReplacements: revised.replacements,
      verificationPlan: revised.plan,
    }),
  ) as IntegrationOperation;
  expect(integrationChecks(saved)).toEqual(revised.plan);
  expect(reviseIntegrationChecks(saved, []).plan).toEqual(revised.plan);
  expect(JSON.stringify(op.results)).toBe(original);
  expect(op.checkReplacements).toBeUndefined();
});

it('does not replace checks implicitly by name or silently accept invalid replacements', () => {
  const op = operation();
  expect(integrationChecks(op, [{ name: old.name, run: 'ruff check changed.py' }])).toContainEqual(
    old,
  );
  expect(() => reviseIntegrationChecks(op, [{ ...old, replaces: 'unknown' }])).toThrow('unknown');
  expect(() =>
    reviseIntegrationChecks(op, [{ ...old, name: 'Skip Ruff', replaces: old.run }]),
  ).toThrow('preserve the check name');
  expect(op.checkReplacements).toBeUndefined();
});

it('persists an explicit shell correction without keeping the old system-shell command', () => {
  const op = operation();
  const revised = reviseIntegrationChecks(op, [{ ...old, shell: 'powershell', replaces: old.run }]);
  expect(revised.plan).toEqual([build, { ...old, shell: 'powershell' }]);
  op.checkReplacements = revised.replacements;
  op.verificationPlan = revised.plan;
  expect(reviseIntegrationChecks(op, []).plan).toEqual(revised.plan);
});

it('keeps distinct shell invocations and deduplicates the default system shell', () => {
  const op = operation();
  expect(
    integrationChecks(op, [old, { ...old, shell: 'system' }, { ...old, shell: 'powershell' }]),
  ).toEqual([build, { ...old, shell: 'system' }, { ...old, shell: 'powershell' }]);
});

it('repairs a command saved under two shells with one replacement', () => {
  const op = operation();
  // The state a shell-only resubmission used to leave behind: cmd.exe and PowerShell copies.
  op.verificationPlan = [
    { ...old, shell: 'system' },
    { ...old, shell: 'powershell' },
  ];
  const wrapped = { name: old.name, run: `powershell -Command "${old.run}"` };
  const revised = reviseIntegrationChecks(op, [{ ...wrapped, replaces: old.run }]);
  expect(revised.plan).toEqual([build, wrapped]);
  op.checkReplacements = revised.replacements;
  op.verificationPlan = revised.plan;
  expect(reviseIntegrationChecks(op, []).plan).toEqual(revised.plan);
});

it('treats the same command under a stated shell as a correction, not a second check', () => {
  const op = operation();
  const corrected = { ...old, shell: 'powershell' as const };
  const revised = reviseIntegrationChecks(op, [corrected]);
  expect(revised.plan).toEqual([build, corrected]);
  op.checkReplacements = revised.replacements;
  op.verificationPlan = revised.plan;
  // Listing the inherited check again without a shell must not bring cmd.exe back.
  expect(reviseIntegrationChecks(op, [old]).plan).toEqual([build, corrected]);
});

it('recovers only the known legacy shell failure once, preserving the candidate and evidence', () => {
  const op = operation();
  op.error = 'The resolver ended without a verified integration.';
  op.verificationPlan = [build, old, regression];
  op.checkRuns = [{ ...old, head: op.head, state: 'failed', output: '"$files" is not recognized' }];
  const evidence = JSON.stringify(op.checkRuns);
  expect(recoverLegacyCheckShell(op)).toBe(process.platform === 'win32');
  if (process.platform !== 'win32') return;
  expect(op.state).toBe('verifying');
  expect(op.head).toBe('candidate');
  expect(op.attempts).toBe(0);
  expect(integrationChecks(op)).toEqual([build, { ...old, shell: 'powershell' }, regression]);
  expect(JSON.stringify(op.checkRuns)).toBe(evidence);
  op.state = 'failed';
  expect(recoverLegacyCheckShell(op)).toBe(false);
  const unrelated = operation();
  unrelated.error = op.error;
  unrelated.checkRuns = [{ ...old, head: op.head, state: 'failed', output: 'Ruff found errors' }];
  expect(recoverLegacyCheckShell(unrelated)).toBe(false);
  unrelated.state = 'paused';
  expect(recoverLegacyCheckShell(unrelated)).toBe(false);
});

it('reports the actual check failure after a resolver ends or legacy generic error was saved', () => {
  const op = operation();
  op.error = 'The resolver ended without a verified integration.';
  op.checkRuns = [{ ...old, head: op.head, state: 'failed', output: 'cmd cannot run $files' }];
  expect(integrationFailure(op)).toContain('Ruff: verification failed\ncmd cannot run $files');
  op.checkRuns[0]!.error = 'Ruff: exit 7\nactual output';
  expect(integrationFailure(op)).toBe('Ruff: exit 7\nactual output');
  op.error = 'Candidate changed during verification';
  expect(integrationFailure(op)).toBe(op.error);
});

it('validates shell metadata and permits replacements only for integration verification', () => {
  const check = { ...old, shell: 'powershell', replaces: old.run };
  expect(readVerificationPlan([check], true)).toEqual([check]);
  expect(readVerificationPlan([check])).toContain('Only verify_integration');
  expect(readVerificationPlan([{ ...old, shell: 'unrecognized' }], true)).toContain('Check shell');
  expect(readVerificationPlan([{ ...old, replaces: ' ' }], true)).toContain('non-empty');
});
