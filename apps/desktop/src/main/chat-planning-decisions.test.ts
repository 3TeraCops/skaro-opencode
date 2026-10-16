import { describe, expect, it } from 'vitest';
import { savedPlanStatus } from './chat-planning-status';
import { planningNextStep } from './chat-planning-next';
import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';

describe('planning decisions and continuation with real storage', () => {
  it('handles a real turn-completed event by persisting a blocker without starting an agent', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      const store = w.engine.planning.store(w.live);
      store.put({ ...store.get('dialogue')!, attempts: 2 });
      const event = {
        t: 'turn.completed' as const,
        turnId: 'stopped-too-early',
        outcome: 'done' as const,
      };
      w.engine.history.onEvent(w.live, event);
      w.engine.planningContinuation.onEvent(w.live, event);
      for (let i = 0; i < 100 && store.get('dialogue')!.state !== 'blocked'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(store.get('dialogue')!.state).toBe('blocked');
      expect(
        w.live.timeline.state.items.some(
          (item) => item.kind === 'notice' && item.text.includes('осталось 75'),
        ),
      ).toBe(true);
      expect(w.live.session).toBeUndefined();
      expect((await w.store.load()).tasks).toHaveLength(0);
    } finally {
      await w.close();
    }
  });
  it('keeps the whole plan unproposed until all specifications are ready and treats superseded specs as blockers', async () => {
    const w = await planningWorkspace();
    try {
      const pending = await w.store.createSpec({
        title: 'Дополнительное правило',
        status: 'proposed',
      });
      w.engine.project(w.live.projectId).invalidate();
      const args = dialoguePlan();
      args.milestones[0]!.tasks[0]!.spec = pending.id;
      await w.engine.planning.prepare(w.live, args);
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      let plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(
        savedPlanStatus(plan, w.live.timeline.state.items, await w.store.load()).counts,
      ).toMatchObject({ proposed: 0, unproposed: 75 });
      expect(plan.state).toBe('waiting');
      await w.store.setSpecStatus(pending.id, 'superseded');
      w.engine.project(w.live.projectId).invalidate();
      expect(
        planningNextStep(plan, w.live.timeline.state.items, await w.store.load(), 0).action,
      ).toBe('blocked');
      expect((await w.engine.planning.propose(w.live, { key: 'dialogue' })).isError).toBe(true);
      plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(plan.state).toBe('blocked');
    } finally {
      await w.close();
    }
  });
  it('waits for real specification acceptance and resumes when it is accepted', async () => {
    const w = await planningWorkspace();
    try {
      await w.store.setSpecStatus('0001', 'proposed');
      w.engine.project(w.live.projectId).invalidate();
      await w.engine.planning.prepare(w.live, dialoguePlan());
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      let plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(plan.state).toBe('waiting');
      expect(w.engine.proposals.proposals(w.live)).toHaveLength(0);
      expect(planningNextStep(plan, [], await w.store.load(), 0).action).toBe('waiting');
      await w.store.setSpecStatus('0001', 'accepted');
      w.engine.project(w.live.projectId).invalidate();
      expect(planningNextStep(plan, [], await w.store.load(), 0).action).toBe('continue');
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(
        savedPlanStatus(plan, w.live.timeline.state.items, await w.store.load()).counts.proposed,
      ).toBe(75);
    } finally {
      await w.close();
    }
  });

  it('limits continuations without progress and prevents cancelled or interrupted work from restarting', async () => {
    const w = await planningWorkspace();
    try {
      await w.engine.planning.prepare(w.live, dialoguePlan());
      const plan = w.engine.planning.store(w.live).get('dialogue')!;
      expect(planningNextStep({ ...plan, attempts: 2 }, [], await w.store.load(), 2).action).toBe(
        'blocked',
      );
      await w.engine.planning.propose(w.live, { key: 'dialogue', milestone: 'M08' });
      expect(
        planningNextStep(
          { ...plan, attempts: 2 },
          w.live.timeline.state.items,
          await w.store.load(),
          2,
        ).action,
      ).toBe('continue');
      w.engine.planningContinuation.schedule(w.live);
      w.engine.planningContinuation.stop(w.live, 'Владелец остановил выполнение');
      expect(w.live.planningTimer).toBeUndefined();
      expect(w.engine.planning.store(w.live).get('dialogue')!.state).toBe('paused');
      expect((await w.engine.planning.propose(w.live, { key: 'dialogue' })).isError).toBe(true);
      await w.engine.planning.control(w.live, {
        key: 'dialogue',
        action: 'cancel',
        reason: 'Владелец отменил поручение',
      });
      expect(w.engine.planning.store(w.live).current()).toBeUndefined();
      expect(
        (
          await w.engine.planning.control(w.live, {
            key: 'dialogue',
            action: 'resume',
            reason: 'Попытка возобновления',
          })
        ).isError,
      ).toBe(true);
    } finally {
      await w.close();
    }
  });
});
