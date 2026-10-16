import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { codexLimits } from './limits.ts';

it('reads both windows from an existing real app-server capture, by duration', () => {
  const lines = readFileSync(
    new URL('../../../fixtures/golden/codex/read/raw.jsonl', import.meta.url),
    'utf8',
  );
  const event = lines
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((event) => event.line.method === 'account/rateLimits/updated');
  expect(event).toBeDefined();
  const snapshot = codexLimits(event.line.params);
  expect(snapshot.windows.map((w) => [w.kind, w.remainingPercent])).toEqual([
    ['five_hour', 99],
    ['seven_day', 66],
  ]);
  const limits = event.line.params.rateLimits;
  // Wire names don't guarantee durations: the same real windows still classify when reversed.
  const reversed = { ...limits, primary: limits.secondary, secondary: limits.primary };
  expect(codexLimits({ rateLimits: reversed }).windows.map((w) => w.kind)).toEqual([
    'seven_day',
    'five_hour',
  ]);
  // A current named bucket wins over the legacy view.
  expect(
    codexLimits({ rateLimits: reversed, rateLimitsByLimitId: { codex: limits } }).windows,
  ).toEqual(snapshot.windows);
});

it('does not turn an unavailable account response into a full or exhausted quota', () => {
  expect(codexLimits(null).windows).toEqual([]);
});
