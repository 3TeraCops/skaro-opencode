import { describe, expect, it } from 'vitest';
import type { AgentSettings } from '../../../shared/ipc';
import { runSettings } from './run-settings';

const task: AgentSettings = {
  agent: 'claude-code',
  model: 'task-model',
  effort: 'low',
  permissionMode: 'ask',
  isolation: 'worktree',
  planFirst: true,
};

describe('board launch settings', () => {
  it.each(['claude-code', 'codex'] as const)(
    'takes all project defaults for a new task with %s',
    (agent) => {
      expect(
        runSettings(
          {
            defaultAgent: agent,
            defaultModel: 'project-model',
            defaultEffort: 'xhigh',
            permissionMode: 'full',
            isolation: 'in-place',
          },
          task,
          false,
        ),
      ).toEqual({
        agent,
        model: 'project-model',
        effort: 'xhigh',
        permissionMode: 'full',
        isolation: 'in-place',
        planFirst: true,
      });
    },
  );

  it('does not keep a task model when the project uses the agent default', () => {
    expect(
      runSettings(
        {
          defaultAgent: 'codex',
          permissionMode: 'auto',
          isolation: 'worktree',
        },
        task,
        false,
      ),
    ).toEqual({
      agent: 'codex',
      effort: 'high',
      permissionMode: 'auto',
      isolation: 'worktree',
      planFirst: true,
    });
  });

  it('keeps the established settings when restarting a task', () => {
    expect(
      runSettings(
        {
          defaultAgent: 'codex',
          defaultModel: 'project-model',
          defaultEffort: 'high',
          permissionMode: 'full',
          isolation: 'in-place',
        },
        task,
        true,
      ),
    ).toEqual(task);
  });
});
