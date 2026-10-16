import { expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@skaro/core';
import { agentDefaultsChanged, taskAgentPreferences } from './task-agent-preferences';

it('inherits project effort even without an explicit model and defaults to high', () => {
  expect(taskAgentPreferences(DEFAULT_CONFIG, {}, null).effort).toBe('high');
  expect(taskAgentPreferences({ ...DEFAULT_CONFIG, defaultEffort: 'xhigh' }, {}, null).effort).toBe(
    'xhigh',
  );
});

it('follows changed project defaults after resetting a new task, preserving task overrides otherwise', () => {
  const config = {
    ...DEFAULT_CONFIG,
    defaultAgent: 'codex',
    defaultModel: 'new-model',
    defaultEffort: 'xhigh',
  };
  const task = { agent: 'claude-code', model: 'old-model' };
  const saved = { agent: 'claude-code' as const, model: 'old-model', effort: 'low' };
  expect(taskAgentPreferences(config, task, saved)).toEqual(saved);
  expect(taskAgentPreferences(config, task, { ...saved, followProject: true })).toEqual({
    agent: 'codex',
    model: 'new-model',
    effort: 'xhigh',
  });
  expect(
    taskAgentPreferences({ ...config, defaultModel: undefined }, task, { followProject: true }),
  ).toEqual({
    agent: 'codex',
    effort: 'xhigh',
  });
  expect(agentDefaultsChanged(config, { ...config, permissionMode: 'full' })).toBe(false);
  expect(agentDefaultsChanged(config, { ...config, defaultEffort: 'high' })).toBe(true);
});

it('keeps a legacy started task on its native model even if it has no saved model', () => {
  const config = {
    ...DEFAULT_CONFIG,
    defaultAgent: 'claude-code',
    defaultModel: 'new-model',
    defaultEffort: 'xhigh',
  };
  expect(
    taskAgentPreferences(
      config,
      {},
      { effort: 'medium' },
      { agent: 'codex', model: 'native-model' },
    ),
  ).toEqual({ agent: 'codex', model: 'native-model', effort: 'medium' });
});
