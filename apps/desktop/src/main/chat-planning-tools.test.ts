import { describe, expect, it } from 'vitest';
import { projectTools, type SkaroScope } from '@skaro/mcp-server';
import { ChatSessions } from './chats';
import { planningWorkspace } from './chat-planning-test-workspace';
import { dialoguePlan } from './chat-planning-test-workspace';
import { planningProposalProblem } from './chat-planning-guard';

describe('saved planning MCP entry points', () => {
  it('requires persistence before legacy batches and prevents bypassing an unfinished plan', async () => {
    const w = await planningWorkspace();
    try {
      expect(planningProposalProblem(w.live, w.engine.planning, 0)).toBeUndefined();
      expect(planningProposalProblem(w.live, w.engine.planning, 1)).toBeUndefined();
      expect(planningProposalProblem(w.live, w.engine.planning, 28)).toContain(
        'COMPLETE saved plan',
      );
      await w.engine.planning.prepare(w.live, dialoguePlan());
      expect(planningProposalProblem(w.live, w.engine.planning, 1)).toContain('propose_saved_plan');
      expect(planningProposalProblem(w.live, w.engine.planning, 0)).toBeUndefined();
      await w.engine.planning.propose(w.live, { key: 'dialogue' });
      await w.engine.planning.finish(w.live, { key: 'dialogue' });
      expect(planningProposalProblem(w.live, w.engine.planning, 1)).toBeUndefined();
      expect(planningProposalProblem(w.live, w.engine.planning, 2)).toContain(
        'COMPLETE saved plan',
      );
    } finally {
      await w.close();
    }
  });
  it('offers the four tools only to normal project chats and rejects incomplete arguments before any write', async () => {
    const w = await planningWorkspace();
    try {
      const tools = projectTools(new ChatSessions(w.engine.deps));
      const names = ['prepare_plan', 'propose_saved_plan', 'finish_plan', 'control_plan'];
      const planning = tools.filter((t) => names.includes(t.name));
      expect(planning.map((t) => t.name)).toEqual(names);
      const scope: SkaroScope = {
        kind: 'project_chat',
        projectId: w.live.projectId,
        chatId: w.live.chat.id,
      };
      expect(planning.every((t) => t.available?.(scope))).toBe(true);
      expect(planning.some((t) => t.available?.({ ...scope, importId: 'import' }))).toBe(false);
      expect(
        planning.some((t) =>
          t.available?.({
            kind: 'task',
            projectId: w.live.projectId,
            taskId: 'T-001',
            runId: 'run',
          }),
        ),
      ).toBe(false);
      const prepare = planning[0]!;
      const result = await prepare.call(
        {
          key: 'dialogue',
          title: 'Все задачи',
          expected_total: 75,
          milestones: [
            {
              milestone: 'M08',
              requirements: [],
              tasks: [
                {
                  ref: 'journal',
                  title: 'Журнал',
                  goal: 'Запись событий',
                  criteria: ['События сохраняются'],
                  requirements: [],
                },
              ],
            },
          ],
        },
        scope,
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain('expected_total');
      expect(w.engine.planning.store(w.live).list()).toHaveLength(0);
    } finally {
      await w.close();
    }
  });
});
