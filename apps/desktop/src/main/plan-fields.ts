import type { Milestone } from '@skaro/core';
import type { MilestoneInfo, MilestoneInput } from '../shared/ipc';
import { headings } from './task-body';

const GOAL = new Set(['цель', 'goal']);
const DONE = new Set(['критерий готовности', 'done when', 'definition of done']);

/** "Цель" and "Критерий готовности" of a milestone body. */
export function milestoneSections(body: string): { goal?: string; criteria?: string } {
  const parts: Record<'goal' | 'criteria', string[]> = { goal: [], criteria: [] };
  let current: 'goal' | 'criteria' | undefined;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const name = heading[1]!.toLowerCase();
      current = GOAL.has(name) ? 'goal' : DONE.has(name) ? 'criteria' : undefined;
      continue;
    }
    if (current) parts[current].push(line);
  }
  const goal = parts.goal.join('\n').trim();
  const criteria = parts.criteria.join('\n').trim();
  return { ...(goal ? { goal } : {}), ...(criteria ? { criteria } : {}) };
}

export function milestoneBody(input: MilestoneInput, locale: string): string {
  const h = headings(locale);
  return `## ${h.goal}\n\n${input.goal.trim()}\n\n## ${h.done}\n\n${input.criteria.trim()}\n`;
}

/** The acceptance of a stage ticks the criterion as a list; the plan shows its words. */
function readinessWords(criteria: string): string {
  return criteria
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean)
    .join('; ');
}

export function milestoneInfo(m: Milestone): MilestoneInfo {
  const { goal, criteria } = milestoneSections(m.body);
  return {
    id: m.id,
    title: m.title,
    order: m.order,
    ...(goal ? { goal } : {}),
    ...(criteria ? { criteria: readinessWords(criteria) } : {}),
  };
}
