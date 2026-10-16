import { expect, it } from 'vitest';
import { CodexAuthRevision, CodexSessionAuth } from './session-auth.ts';

it('invalidates existing processes on login and keeps a subsequently loaded process current', () => {
  const revision = new CodexAuthRevision();
  const first = new CodexSessionAuth(revision);
  const second = new CodexSessionAuth(revision);
  first.loaded(first.current);
  second.loaded(second.current);
  expect(first.stale).toBe(false);
  expect(second.stale).toBe(false);

  revision.signedIn();
  expect(first.stale).toBe(true);
  expect(second.stale).toBe(true);
  first.loaded(first.current);
  expect(first.stale).toBe(false);
  expect(second.stale).toBe(true);
});

it('invalidates only the process that failed auth, including after an external login', () => {
  const first = new CodexSessionAuth();
  const second = new CodexSessionAuth();
  first.loaded(first.current);
  second.loaded(second.current);
  first.failed('auth');
  expect(first.stale).toBe(true);
  expect(second.stale).toBe(false);
  // Reattachment resets the terminal failure; ordinary requests cannot clear it.
  first.failed('network');
  expect(first.stale).toBe(true);
  first.loaded(first.current);
  expect(first.stale).toBe(false);
});

it('does not accept an initialization that raced with a newer login', () => {
  const revision = new CodexAuthRevision();
  const auth = new CodexSessionAuth(revision);
  const startedWith = auth.current;
  revision.signedIn();
  auth.loaded(startedWith);
  expect(auth.stale).toBe(true);
  auth.loaded(auth.current);
  expect(auth.stale).toBe(false);
});

it('does not invalidate healthy processes for limits, network errors or normal completion', () => {
  const auth = new CodexSessionAuth();
  auth.loaded(auth.current);
  for (const category of ['limit', 'network', 'overloaded', 'other', undefined] as const)
    auth.failed(category);
  expect(auth.stale).toBe(false);
});
