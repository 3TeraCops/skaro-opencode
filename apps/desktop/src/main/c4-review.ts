import { dirname } from 'node:path';
import { background } from './background/client';
import {
  validateC4Code,
  realizeC4,
  validateC4Model,
  ancestors,
  type AppDb,
  type ProjectArtifacts,
} from '@skaro/core';
import type { ReviewC4Args } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';

export interface C4TaskReview extends ReviewC4Args {
  runId: string;
  baseHead: string;
  modelHash: string;
}
import { c4ArchitectureHash, c4ChangeHash, c4ReviewKey } from './c4-fingerprint';
export { c4ArchitectureHash, c4ChangeHash, c4ReviewKey } from './c4-fingerprint';

export function c4CoverageProblems(
  artifacts: ProjectArtifacts,
  taskId: string,
  review?: ReviewC4Args,
): string[] {
  const problems = [...(artifacts.c4Problems ?? [])];
  const model = artifacts.c4;
  if (!model)
    return [...problems, 'Prepare and accept the project C4 model before architecture acceptance.'];
  const task = artifacts.tasks.find((t) => t.id === taskId);
  const spec = task?.spec ? model.specifications.find((s) => s.id === task.spec) : undefined;
  if (task?.spec && !spec) problems.push(`SPEC-${task.spec}: missing C4 coverage`);
  const affected = new Set([
    ...(review?.elements ?? []),
    ...(review?.relationships ?? []),
    ...(spec?.elements ?? []),
    ...(spec?.relationships ?? []),
    ...(spec?.views ?? []),
  ]);
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  for (const view of model.views.filter((v) => affected.has(v.id))) affected.add(view.scope);
  for (const relation of model.relationships.filter((r) => affected.has(r.id))) {
    affected.add(relation.source);
    affected.add(relation.target);
  }
  for (const id of [...affected]) for (const parent of ancestors(id, byId)) affected.add(parent);
  for (const question of model.questions)
    if (question.affects.some((id) => affected.has(id)))
      problems.push(`${question.id}: ${question.question}`);
  if (review) {
    if (!review.elements.length)
      problems.push('Review must identify the architectural elements inspected in code.');
    if (!review.aligned) problems.push('The agent reported an architectural mismatch.');
    if (review.revision !== model.revision)
      problems.push('C4 changed after review. Read context and review again.');
    for (const [field, entries] of [
      ['elements', model.elements],
      ['relationships', model.relationships],
    ] as const)
      for (const id of review[field])
        if (!entries.some((e) => e.id === id)) problems.push(`Unknown ${field}: ${id}`);
    for (const id of spec?.elements ?? [])
      if (!review.elements.includes(id))
        problems.push(`Review must cover specification element ${id}`);
    for (const id of spec?.relationships ?? [])
      if (!review.relationships.includes(id))
        problems.push(`Review must cover specification relationship ${id}`);
    for (const id of review.realized) {
      const entry = [...model.elements, ...model.relationships].find((e) => e.id === id);
      if (
        !entry ||
        ![...review.elements, ...review.relationships].includes(id) ||
        (entry.state !== 'planned' && !entry.planned && !model.removals?.some((r) => r.id === id))
      )
        problems.push(`Realization ${id} must be a reviewed planned change`);
    }
  }
  return problems;
}

export async function assertC4TaskReview(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  checkout: string,
  runId?: string,
): Promise<C4TaskReview> {
  context.invalidate();
  const artifacts = await context.load();
  const review = db.getSetting<C4TaskReview | null>(c4ReviewKey(context.id, taskId), null);
  if (!review || (runId && review.runId !== runId))
    throw new Error(`${taskId}: call review_c4 with code evidence before submitting the result`);
  const problems = c4CoverageProblems(artifacts, taskId, review);
  const packages = await background(dirname(db.filePath), 'c4.list', context.id, taskId);
  if (
    packages.some(
      (p) => p.package.task?.id === taskId && ['pending', 'accepted'].includes(p.item.state),
    )
  )
    problems.push('A task architecture package is still pending.');
  if (review.modelHash !== c4ArchitectureHash(artifacts))
    problems.push('Architecture or its documents changed after review.');
  if (review.changeHash !== (await c4ChangeHash(checkout, review.baseHead)))
    problems.push('Code changed after C4 review; review it again.');
  if (artifacts.c4) {
    const realized = realizeC4(artifacts.c4, review.realized);
    problems.push(...validateC4Model(realized), ...(await validateC4Code(checkout, realized)));
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return review;
}
