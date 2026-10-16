import { afterEach, beforeEach, expect, it } from 'vitest';
import { Timeline } from '@skaro/timeline';
import { CompletionFixture } from './completion-test-support';
import { IntegrationHistory } from './integration-history';
import { TaskStartup } from './task-startup';
import type { Events } from '../shared/ipc';

let f: CompletionFixture;
beforeEach(async () => {
  f = await CompletionFixture.create();
});
afterEach(async () => {
  await f.close();
});

it('shows preparation failure before a native run and retains startup input after restart', async () => {
  const task = await f.task('Startup failure');
  const startup = new TaskStartup(f.db);
  const message = { text: 'continue real task' };
  startup.begin(f.projectId, task.id, [message]);
  startup.fail(f.projectId, task.id, 'dependency conflict in models.py');
  await f.restart();
  const restored = new TaskStartup(f.db);
  expect(f.db.listRuns(f.projectId, task.id)).toEqual([]);
  expect(restored.error(f.projectId, task.id)).toBe('dependency conflict in models.py');
  expect(restored.begin(f.projectId, task.id, [])).toEqual([message]);
  restored.delivered(f.projectId, task.id);
  expect(restored.read(f.projectId, task.id)).toBeUndefined();
}, 15_000);

it('persists a large output burst in ordered batches without reloading task metadata', async () => {
  const task = await f.task('Output burst');
  await f.commit();
  const store = f.integrations.deps.store;
  const op = store.create(
    {
      projectId: f.projectId,
      taskId: task.id,
      purpose: 'dependencies',
      base: 'main',
      results: [],
      checks: [],
    },
    await f.context.git.head(),
  );
  const changed: string[] = [];
  const batches: Events['integration.events'][] = [];
  const history = new IntegrationHistory(
    store,
    (_project, task) => changed.push(task),
    (batch) => batches.push(batch),
  );
  await history.event(op, {
    t: 'item.upsert',
    item: {
      id: 'output',
      turnId: '',
      kind: 'message',
      role: 'agent',
      text: '',
      status: 'done',
      startedAt: Date.now(),
      native: { agent: 'codex', type: 'agentMessage', ref: 'output' },
    },
  });
  const initial = await history.project(f.projectId, task.id);
  const restored = Timeline.restore(initial.sources.integrations[0]!.timeline);
  batches.length = 0;
  for (let i = 0; i < 8192; i++)
    history.enqueue(op, { t: 'item.append', itemId: 'output', field: 'text', chunk: String(i) });
  await history.drain(op);
  expect(batches.length).toBe(32);
  expect(batches.map((batch) => batch.seq)).toEqual(
    Array.from({ length: 32 }, (_, i) => 1 + i * 256),
  );
  expect(changed).toEqual([]);
  expect((await history.events(op)).length).toBe(8193);
  expect(store.find(f.projectId, op.id)?.sequence).toBe(8193);
  for (const batch of batches) for (const event of batch.events) restored.apply(event);
  expect(restored.state.items[0]).toMatchObject({
    text: Array.from({ length: 8192 }, (_, i) => String(i)).join(''),
  });
  const restarted = new IntegrationHistory(store, () => undefined);
  expect((await restarted.project(f.projectId, task.id)).timeline).toEqual(restored.state);
  expect((await history.project(f.projectId, task.id)).revision).toBe(initial.revision);
  await history.close(op);
}, 30_000);

it('shows a merge in the chats of all its tasks and a preparation only in its own', async () => {
  const dependency = await f.task('Accepted input');
  const task = await f.task('Dependent', undefined, [dependency.id]);
  await f.commit();
  await f.accept(dependency, await f.checkout(dependency));
  const store = f.integrations.deps.store;
  const request = {
    projectId: f.projectId,
    taskId: task.id,
    base: 'main',
    results: [f.journal.result(dependency.id)!],
    checks: [],
  };
  const head = await f.context.git.head();
  const preparation = store.create({ ...request, purpose: 'dependencies' }, head);
  const merge = store.create({ ...request, purpose: 'publication' }, head);
  const changed: string[] = [];
  const batches: Events['integration.events'][] = [];
  const history = new IntegrationHistory(
    store,
    (_project, task) => changed.push(task),
    (batch) => batches.push(batch),
  );
  const turn = { t: 'turn.started', turnId: 'turn' } as const;
  await history.event(preparation, turn);
  expect(batches.map((batch) => batch.taskId)).toEqual([task.id]);
  expect(changed).toEqual([task.id]);
  await history.event(merge, turn);
  expect(batches.slice(1).map((batch) => batch.taskId)).toEqual([task.id, dependency.id]);
  expect(changed.slice(1)).toEqual([task.id, dependency.id]);
  const shown = async (taskId: string) =>
    (await history.project(f.projectId, taskId)).sources.integrations.map((source) => source.id);
  expect(await shown(task.id)).toEqual([preparation.id, merge.id]);
  expect(await shown(dependency.id)).toEqual([merge.id]);
  await history.close(preparation);
  await history.close(merge);
}, 30_000);

it('says what Skaro does with a candidate once across repeated executions', async () => {
  const task = await f.task('Repeated execution');
  await f.commit();
  const store = f.integrations.deps.store;
  const op = store.create(
    {
      projectId: f.projectId,
      taskId: task.id,
      purpose: 'publication',
      base: 'main',
      results: [],
      checks: [],
    },
    await f.context.git.head(),
  );
  const history = new IntegrationHistory(store, () => undefined);
  const texts = async () =>
    (await history.events(op)).flatMap((event) =>
      event.t === 'item.upsert' && event.item.kind === 'notice' ? [event.item.text] : [],
    );
  await history.announce(op, 'resolving a.py');
  await history.notice(op, 'agent failed', true);
  await history.announce(op, 'resolving a.py');
  expect(await texts()).toEqual(['resolving a.py', 'agent failed']);
  await history.announce(op, 'resolving a.py, b.py');
  await new IntegrationHistory(store, () => undefined).announce(op, 'resolving a.py, b.py');
  expect(await texts()).toEqual(['resolving a.py', 'agent failed', 'resolving a.py, b.py']);
  await history.close(op);
}, 15_000);

it('retains a newer publication request when an old executor saves its checkpoint', async () => {
  const task = await f.task('Publication intent');
  await f.commit();
  const store = f.integrations.deps.store;
  const op = store.create(
    {
      projectId: f.projectId,
      taskId: task.id,
      purpose: 'publication',
      base: 'main',
      results: [],
      checks: [],
      publish: true,
      target: task.id,
      message: 'initial',
    },
    await f.context.git.head(),
  );
  const writer = structuredClone(op);
  store.publish(op, { target: 'M01', partial: true, message: 'new request' });
  writer.sequence++;
  store.save(writer);
  expect(store.find(f.projectId, op.id)).toMatchObject({
    publish: true,
    target: 'M01',
    partial: true,
    message: 'new request',
    sequence: 1,
  });
}, 15_000);

it('recovers abandoned resolver turns without replacing the task model, usage or activity', async () => {
  const task = await f.task('History owner');
  await f.commit();
  const op = f.integrations.deps.store.create(
    {
      projectId: f.projectId,
      taskId: task.id,
      purpose: 'publication',
      base: 'main',
      results: [],
      checks: [],
    },
    await f.context.git.head(),
  );
  const history = new IntegrationHistory(f.integrations.deps.store, () => undefined);
  await history.event(op, {
    t: 'session.started',
    nativeSessionId: 'resolver',
    model: 'resolver-model',
    capabilities: {},
  });
  await history.event(op, { t: 'turn.started', turnId: 'abandoned' });
  await history.event(op, { t: 'activity', state: 'thinking' });
  await history.event(op, { t: 'usage', inputTokens: 100, outputTokens: 20 });
  const base = Timeline.from([
    { t: 'session.started', nativeSessionId: 'task', model: 'task-model', capabilities: {} },
    { t: 'usage', inputTokens: 12, outputTokens: 4 },
    {
      t: 'interaction.opened',
      interaction: {
        kind: 'approval',
        id: 'current-task-approval',
        action: { type: 'command', title: 'Current task command' },
        choices: ['allow_once', 'deny'],
      },
    },
  ]).state;
  // The resolver ended its turn with a command in the background and its process was stopped.
  await history.event(op, {
    t: 'item.upsert',
    item: {
      id: 'tests',
      turnId: 'abandoned',
      kind: 'command',
      command: 'run tests',
      output: '',
      outputLive: false,
      background: { taskId: 'bg-1', state: 'running' },
      status: 'running',
      startedAt: Date.now(),
      native: { agent: 'claude', type: 'tool_use.Bash', ref: 'tests' },
    },
  });
  await history.recover(op);
  const view = await history.project(f.projectId, task.id, base);
  expect(view.timeline.items.find((item) => item.kind === 'command')).toMatchObject({
    status: 'interrupted',
    background: { taskId: 'bg-1', state: 'stopped' },
  });
  expect(view.timeline.turns[0]?.outcome).toBe('interrupted');
  expect(view.timeline.session).toEqual(base.session);
  expect(view.timeline.usage).toEqual(base.usage);
  expect(view.timeline.activity).toBeUndefined();
  expect(view.timeline.status).toBe(base.status);
  expect(view.timeline.interactions).toEqual(base.interactions);
}, 15_000);
