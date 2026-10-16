import { expect, it } from 'vitest';
import { historyPage } from './task-history-context';

it('allows reading all of a long result and searching old decisions without silent truncation', () => {
  const text = `User decision: preserve data\ncommand output: ${'x'.repeat(50000)}\nlast action`;
  let offset = 0;
  let output = '';
  while (true) {
    const page = historyPage(text, '', offset, 12000);
    output += page.text;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  expect(output).toBe(text);
  expect(historyPage(text, 'USER DECISION', 0, 12000)).toEqual({
    text: 'User decision: preserve data',
    nextOffset: null,
    totalCharacters: 28,
  });
});
