import { expect, it } from 'vitest';
import { replanWorkspace } from './task-replan-test-workspace';
import { TaskRunEngine } from './task-run-engine';
import { taskReplanLockKey } from './project-task-mutations';

it('coordinates real deferred launches and refuses queueing a replaced identity', async () => {
  const w = await replanWorkspace();
  const runs = new TaskRunEngine(w.engine.deps);
  try {
    const projectId = w.live.projectId;
    // B is blocked by A: scheduling saves the request without launching an agent.
    await runs.scheduling.launch(projectId, [w.b.id], 'Запустить после обработки');
    expect(runs.scheduling.awaiting(projectId)[w.b.id]).toBeDefined();
    await expect(w.offer()).rejects.toThrow('not queued or scheduled');
    runs.scheduling.forgetAwaiting(projectId, [w.b.id]);
    const item = await w.offer();
    w.db.setSetting(taskReplanLockKey(projectId), item.id);
    await expect(runs.scheduling.launch(projectId, [w.a.id], 'Запустить')).rejects.toThrow(
      'recovering',
    );
    expect(runs.queue.state().running).toEqual([]);
    w.db.setSetting(taskReplanLockKey(projectId), null);
    await w.apply(item);
    await expect(
      runs.scheduling.enqueue(projectId, w.b.id, { text: 'Запустить' }),
    ).rejects.toThrow();
    expect(runs.queue.state().running).toEqual([]);
    expect(w.db.listRuns(projectId)).toEqual([]);
  } finally {
    await runs.sessions.close();
    await w.close();
  }
});
