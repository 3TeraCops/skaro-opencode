import type { Spec, ProjectArtifacts } from '@skaro/core';
import { adrId } from './chat-proposal-helpers';

/** A linked specification must still be accepted when the user applies the plan. */
export function planSpecProblem(
  tasks: { title: string; spec?: string }[],
  specs: Spec[],
  artifacts?: ProjectArtifacts,
): string | undefined {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const invalid = tasks.filter(
    (task) => task.spec && byId.get(adrId(task.spec))?.status !== 'accepted',
  );
  if (invalid.length)
    return (
      `Tasks must reference accepted specifications: ${invalid.map((task) => `${task.title} → SPEC-${adrId(task.spec!)}`).join(', ')}. ` +
      'Prepare specifications and C4 coverage in this project chat with propose_c4, obtain acceptance, then propose implementation tasks. ' +
      'A milestone may have tasks: []; do not create specification-preparation tasks.'
    );
  if (artifacts && tasks.some((t) => t.spec)) {
    const problems = artifacts.c4Problems ?? [];
    const uncovered = tasks.filter(
      (t) => t.spec && !artifacts.c4?.specifications.some((s) => s.id === adrId(t.spec!)),
    );
    if (!artifacts.c4 || problems.length || uncovered.length)
      return `C4 coverage blocks implementation planning: ${[...problems, ...uncovered.map((t) => `${t.title} → SPEC-${t.spec}`)].join('; ')}. Prepare and accept one propose_c4 package first.`;
  }
  return undefined;
}
