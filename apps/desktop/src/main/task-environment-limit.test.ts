import { COMPOSE_PROJECT, type DockerContainer, type TaskKey } from '@skaro/core';
import { describe, expect, it } from 'vitest';
import { reconcileTaskEnvironments } from './task-environment-limit';

const task = (taskId: string): TaskKey => ({ projectId: 'p1', taskId });
const record = (taskId: string, usedAt: number) => ({
  ...task(taskId),
  name: `skaro-shop-${taskId.toLowerCase()}`,
  ports: {},
  created: true,
  usedAt,
});
const container = (taskId: string, running = true): DockerContainer => ({
  Id: `${taskId}-${running}`,
  Name: `/${taskId}`,
  State: { Running: running },
  Config: { Labels: { [COMPOSE_PROJECT]: `skaro-shop-${taskId.toLowerCase()}` } },
  Mounts: [],
});

async function run(options: {
  running: string[];
  busy?: string[];
  starting?: string;
  done?: string[];
}) {
  const records = [record('T-1', 100), record('T-2', 200), record('T-3', 300), record('T-4', 400)];
  const stopped: string[] = [];
  const stale = await reconcileTaskEnvironments({
    containers: options.running.map((id) => container(id)),
    worktrees: '/data/worktrees',
    names: new Map(records.map((r) => [r.name, r])),
    records,
    busy: (options.busy ?? []).map(task),
    ...(options.starting ? { starting: task(options.starting) } : {}),
    finished: async (key) => (options.done ?? []).includes(key.taskId),
    stop: async (containers) => void stopped.push(...containers.map((c) => c.Name.slice(1))),
  });
  return { stopped, stale: stale.map((key) => key.taskId) };
}

describe('ownership of running task environments', () => {
  it('stops every idle environment even with spare queue slots', async () => {
    expect(await run({ running: ['T-1', 'T-2', 'T-3', 'T-4'] })).toEqual({
      stopped: ['T-1', 'T-2', 'T-3', 'T-4'],
      stale: [],
    });
  });

  it('never stops a working task and makes room for the one that starts', async () => {
    const result = await run({
      running: ['T-1', 'T-2', 'T-3'],
      busy: ['T-1', 'T-4'],
      starting: 'T-4',
    });
    // T-1 works, T-4 is about to start: no place is left for the idle T-2 and T-3.
    expect(result.stopped.sort()).toEqual(['T-2', 'T-3']);
  });

  it('hands finished idle tasks over for removal, stopped ones included', async () => {
    const result = await run({ running: ['T-3'], busy: ['T-2'], done: ['T-1', 'T-2'] });
    expect(result).toEqual({ stopped: ['T-3'], stale: ['T-1'] });
  });

  it('does not stop the primary Compose project or another application', async () => {
    const records = [record('T-1', 100)];
    const foreign = ['shop', 'unrelated'].map((name) => ({
      ...container(name),
      Config: { Labels: { [COMPOSE_PROJECT]: name } },
    }));
    const stopped: string[] = [];
    await reconcileTaskEnvironments({
      containers: [container('T-1'), ...foreign],
      worktrees: '/data/worktrees',
      names: new Map(records.map((r) => [r.name, r])),
      records,
      busy: [],
      finished: async () => false,
      stop: async (containers) => {
        stopped.push(...containers.map((c) => c.Name));
      },
    });
    expect(stopped).toEqual(['/T-1']);
  });
});
