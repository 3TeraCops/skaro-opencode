import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toMilestone, type ArtifactProblem } from '@skaro/core';
import { ArtifactIndex } from './artifact-index';
import { milestoneInfo } from '../plan-fields';
import type { PayloadStore } from './payload-store';
export async function milestoneWork(store: PayloadStore, root: string, id?: string) {
  const names = (await readdir(join(root, '.skaro', 'milestones')).catch(() => []))
    .filter((name) => name.endsWith('.md'))
    .sort();
  const index = new ArtifactIndex(store, root);
  const milestones = [];
  for (const name of names) {
    const path = `milestones/${name}`;
    if (id && (await index.read(path, false)).fields['id'] !== id) continue;
    const value = await index.read(path);
    const problems: ArtifactProblem[] = [];
    const milestone = toMilestone(value.fields, value.body, `.skaro/${path}`, problems);
    if (milestone) milestones.push(milestone);
  }
  return milestones.sort((a, b) => a.order - b.order).map(milestoneInfo);
}
