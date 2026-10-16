// Opt-in checks using only the installed, signed-in Codex process and its real provider.
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { obj, type RawLine, type SessionOptions, type TimelineEvent } from '@skaro/timeline';
import { CodexAuthRevision } from './session-auth.ts';
import { CodexSession } from './session.ts';

const binary = process.env['SKARO_CODEX_BINARY'];

function options(raw: RawLine[], pids: number[]): SessionOptions {
  return {
    cwd: process.cwd(),
    permissionMode: 'full',
    effort: 'low',
    processStarted: (pid) => pids.push(pid),
    raw: (line) => raw.push(line),
    context: {
      now: Date.now,
      attachImage: () => {
        throw new Error('unexpected image');
      },
    },
  };
}

function requests(raw: RawLine[], method: string): Record<string, unknown>[] {
  return raw
    .filter((line) => line.dir === 'in' && obj(line.line)?.['method'] === method)
    .map((line) => obj(obj(line.line)?.['params']) ?? {});
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Real Codex recovery verification timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function closeSessions(sessions: CodexSession[], pumps: Promise<void>[]): Promise<void> {
  const cleanup = await Promise.allSettled(sessions.map((session) => session.close()));
  const failed = cleanup.filter((result) => result.status === 'rejected');
  if (failed.length)
    throw new AggregateError(
      failed.map((result) => result.reason),
      'Real process cleanup failed',
    );
  await Promise.all(pumps);
}

it.skipIf(!binary)(
  'preserves a real conversation and active work while serializing process recovery',
  async () => {
    const revision = new CodexAuthRevision();
    const raw: RawLine[] = [];
    const pids: number[] = [];
    const otherPids: number[] = [];
    const events: TimelineEvent[] = [];
    const otherEvents: TimelineEvent[] = [];
    const first = new CodexSession(options(raw, pids), {
      binary: binary!,
      pathDirs: [],
      authRevision: revision,
    });
    const other = new CodexSession(options([], otherPids), {
      binary: binary!,
      pathDirs: [],
      authRevision: revision,
    });
    const pump = (async () => {
      for await (const event of first.events) events.push(event);
    })();
    const otherPump = (async () => {
      for await (const event of other.events) otherEvents.push(event);
    })();
    const completed = () => events.filter((event) => event.t === 'turn.completed');
    const marker = randomUUID();
    let steer: Promise<void> | undefined;
    try {
      await first.start();
      await other.start();
      await other.send({ text: 'Reply READY. Do not use tools, read files or change files.' });
      await waitFor(() => otherEvents.some((event) => event.t === 'turn.completed'));
      expect(otherEvents.find((event) => event.t === 'turn.completed')).toMatchObject({
        outcome: 'done',
      });
      const model = events.find((event) => event.t === 'session.started');
      expect(model?.t).toBe('session.started');
      await first.send({
        text:
          `Remember this conversation token: ${marker}. Reply RECORDED. ` +
          'Do not use tools, read files or change files.',
      });
      // Invalidate at the application boundary while the actual provider turn is active.
      revision.signedIn();
      steer = first.steer({ text: 'Also say ACKNOWLEDGED. Do not use tools.' });
      await steer;
      expect(pids).toHaveLength(1);
      expect(otherPids).toHaveLength(1);
      expect(requests(raw, 'turn/interrupt')).toHaveLength(0);
      expect(requests(raw, 'turn/steer')).toHaveLength(1);
      await waitFor(() => completed().length === 1);
      expect(completed()[0]).toMatchObject({ outcome: 'done' });
      await first.setPermissionMode('ask');
      if (model?.t === 'session.started') await first.setModel(model.model, 'medium');
      const message = first.send({
        text: 'Return only the conversation token I asked you to remember. Do not use tools.',
      });
      const clarification = first.steer({
        text: 'Return that exact original token, without commentary.',
      });
      await Promise.all([message, clarification]);
      await waitFor(() => completed().length === 2);
      expect(completed()[1]).toMatchObject({ outcome: 'done' });
      expect(pids).toHaveLength(2);
      expect(otherPids).toHaveLength(1);
      const starts = requests(raw, 'turn/start');
      const resumes = requests(raw, 'thread/resume');
      expect(requests(raw, 'thread/start')).toHaveLength(1);
      expect(starts).toHaveLength(2);
      expect(resumes).toHaveLength(1);
      expect(resumes[0]).toMatchObject({ threadId: starts[0]!['threadId'], excludeTurns: true });
      expect(starts[1]).toMatchObject({
        threadId: starts[0]!['threadId'],
        model: model?.t === 'session.started' ? model.model : '',
        effort: 'medium',
        approvalPolicy: 'untrusted',
        collaborationMode: { mode: 'default' },
      });
      expect(
        events.some(
          (event) =>
            event.t === 'item.upsert' &&
            event.item.kind === 'message' &&
            event.item.role === 'agent' &&
            event.item.text.includes(marker),
        ),
      ).toBe(true);
      await first.close();
      await other.start();
      expect(otherPids).toHaveLength(2);
      expect(events.filter((event) => event.t === 'turn.completed')).toHaveLength(2);
    } catch (error) {
      console.error('Real recovery failure', {
        error,
        pids,
        otherPids,
        methods: raw.filter((line) => line.dir === 'in').map((line) => obj(line.line)?.['method']),
        completed: completed(),
      });
      throw error;
    } finally {
      await steer?.catch(() => undefined);
      await closeSessions([first, other], [pump, otherPump]);
    }
  },
  150_000,
);

it.skipIf(!binary)(
  'does not leave a real process alive when closed during initialization',
  async () => {
    const raw: RawLine[] = [];
    const pids: number[] = [];
    const session = new CodexSession(options(raw, pids), { binary: binary!, pathDirs: [] });
    const starting = session.start();
    const rejected = expect(starting).rejects.toThrow('Codex session is closed');
    try {
      await session.close();
      await rejected;
      expect(pids).toHaveLength(1);
      expect(requests(raw, 'thread/start')).toHaveLength(0);
      expect(raw.some((line) => line.dir === 'meta' && obj(line.line)?.['event'] === 'exit')).toBe(
        true,
      );
      await expect(session.send({ text: 'must not start' })).rejects.toThrow(
        'Codex session is closed',
      );
    } finally {
      await session.close();
    }
  },
  30_000,
);
