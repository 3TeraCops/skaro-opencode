import { expect, it } from 'vitest';
import { limitWindow } from './limits.ts';

it('keeps absent, invalid and exhausted quotas distinct', () => {
  expect(limitWindow('five_hour', null, null).remainingPercent).toBeNull();
  expect(limitWindow('five_hour', NaN, 'invalid').remainingPercent).toBeNull();
  expect(limitWindow('five_hour', 100, null).remainingPercent).toBe(0);
  expect(limitWindow('five_hour', 0, null).remainingPercent).toBe(100);
  expect(limitWindow('five_hour', 120, null).remainingPercent).toBe(0);
});

it('normalizes seconds and ISO offsets without replenishing past resets', () => {
  const reset = '2026-10-01T15:00:00+03:00';
  const seconds = Date.parse(reset) / 1000;
  expect(limitWindow('seven_day', 100, reset)).toEqual(limitWindow('seven_day', 100, seconds));
  expect(limitWindow('seven_day', 100, seconds).remainingPercent).toBe(0);
  expect(limitWindow('seven_day', 100, Infinity).resetsAt).toBeNull();
});
