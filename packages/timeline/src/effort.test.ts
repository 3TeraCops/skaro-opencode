import { expect, it } from 'vitest';
import { selectedEffort } from './effort.ts';
import type { AgentModel } from './agent.ts';

it('uses high instead of a native low default, preserves choices and validates model support', () => {
  const model: AgentModel = {
    id: 'model',
    name: 'Model',
    description: '',
    isDefault: true,
    images: false,
    efforts: ['low', 'medium', 'high', 'xhigh'].map((id) => ({ id })),
    defaultEffort: 'low',
  };
  expect(selectedEffort(model)).toBe('high');
  expect(selectedEffort(model, 'unsupported')).toBe('high');
  expect(selectedEffort(model, 'low')).toBe('low');
  expect(selectedEffort(model, 'xhigh')).toBe('xhigh');
  expect(selectedEffort({ ...model, efforts: [] })).toBeUndefined();
});
