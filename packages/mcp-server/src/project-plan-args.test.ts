import { describe, expect, it } from 'vitest';
import { parseMilestones, parseTasks } from './project-plan-args.ts';

const milestone = {
  title: 'ИИ-черновик',
  goal: 'Предложить ответ оператору.',
  done_when: 'Оператор может отправить ответ.',
};
const task = {
  title: 'Добавить API черновика',
  goal: 'Генерировать черновик.',
  criteria: ['API возвращает черновик'],
  spec: '0001',
};

describe('project plan arguments', () => {
  it('accepts roadmap milestones without inventing preparation tasks', () => {
    expect(parseMilestones({ milestones: [{ ...milestone, tasks: [] }] })).toEqual({
      milestones: [
        { title: milestone.title, goal: milestone.goal, doneWhen: milestone.done_when, tasks: [] },
      ],
    });
  });

  it('preserves generated refs and dependencies in a mixed roadmap', () => {
    const parsed = parseMilestones({
      milestones: [
        { ...milestone, tasks: [] },
        { ...milestone, tasks: [task] },
        { ...milestone, tasks: [{ ...task, depends_on: ['m2-task-1'] }] },
      ],
    });
    expect(parsed.milestones[1]?.tasks[0]?.ref).toBe('m2-task-1');
    expect(parsed.milestones[2]?.tasks[0]?.dependsOn).toEqual(['m2-task-1']);
  });

  it('keeps an empty standalone task proposal invalid', () => {
    expect(() => parseTasks({ tasks: [] })).toThrow('non-empty array');
  });

  it('still rejects malformed milestone task lists and missing criteria', () => {
    for (const tasks of [undefined, null, 'tasks'])
      expect(() => parseMilestones({ milestones: [{ ...milestone, tasks }] })).toThrow(
        'must be an array',
      );
    expect(() =>
      parseMilestones({ milestones: [{ ...milestone, tasks: [{ ...task, criteria: [] }] }] }),
    ).toThrow('criteria');
  });

  it('rejects duplicate refs across milestones even with empty milestones', () => {
    expect(() =>
      parseMilestones({
        milestones: [
          { ...milestone, tasks: [] },
          { ...milestone, tasks: [{ ...task, ref: 'api' }] },
          { ...milestone, tasks: [{ ...task, ref: 'api' }] },
        ],
      }),
    ).toThrow('used twice');
  });
});
