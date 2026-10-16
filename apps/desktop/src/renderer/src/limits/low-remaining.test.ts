import { expect, it } from 'vitest';
import { limitWindow } from '@skaro/timeline';
import { lowRemaining, lowPercentLabel } from './low-remaining';

it('shows the smallest known remaining window strictly below 10%, including zero', () => {
  const snapshot = (five: unknown, week: unknown) => ({
    checkedAt: new Date().toISOString(),
    windows: [limitWindow('five_hour', five, null), limitWindow('seven_day', week, null)],
  });
  expect(lowRemaining(snapshot(90, 40))).toBeUndefined();
  expect(lowRemaining(snapshot(91, 99))).toBe(1);
  expect(lowRemaining(snapshot(20, 100))).toBe(0);
  expect(lowRemaining(snapshot(null, 95))).toBe(5);
  expect(lowRemaining(snapshot(null, NaN))).toBeUndefined();
  expect(lowRemaining(undefined)).toBeUndefined();
});

it('keeps percentages below the threshold and formats the current locale', () => {
  expect(lowPercentLabel(9.99, 'ru')).toBe('9,9%');
  expect(lowPercentLabel(9.99, 'en')).toBe('9.9%');
  expect(lowPercentLabel(0, 'ru')).toBe('0%');
});
