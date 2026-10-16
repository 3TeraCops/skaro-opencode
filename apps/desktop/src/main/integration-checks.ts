import type { ProjectCheck } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import type { IntegrationCheck } from '@skaro/mcp-server';

const shell = (check: ProjectCheck) => check.shell ?? 'system';
const key = (check: ProjectCheck) => JSON.stringify([check.run, shell(check)]);

/** Machine checks cover mandatory project rules and accepted behavior from both inputs. */
export function integrationChecks(
  op: IntegrationOperation,
  derived: ProjectCheck[] = [],
): ProjectCheck[] {
  const checks = [
    ...op.checks,
    ...[...op.results, ...(op.baseResults ?? [])].flatMap((result) => result.verification ?? []),
    ...(op.verificationPlan ?? []),
    ...derived,
  ];
  for (const replacement of op.checkReplacements ?? [])
    for (let i = 0; i < checks.length; i++)
      if (checks[i]!.run === replacement.replaces) checks[i] = replacement.check;
  return [...new Map(checks.map((check) => [key(check), check])).values()];
}

/** Replace an exact command without editing accepted inputs or dropping unrelated checks. */
export function reviseIntegrationChecks(op: IntegrationOperation, submitted: IntegrationCheck[]) {
  const replacements = [...(op.checkReplacements ?? [])];
  const additional: ProjectCheck[] = [];
  for (const { replaces, ...check } of submitted) {
    const current = integrationChecks({ ...op, checkReplacements: replacements }, additional);
    const saved = current.filter((item) => item.run === (replaces ?? check.run));
    if (replaces) {
      // A replacement covers the command under every shell it was saved with.
      if (!saved.length)
        throw new Error(`Cannot replace an unknown verification command: ${replaces}`);
      const renamed = saved.find((item) => item.name !== check.name);
      if (renamed) throw new Error(`Replacement must preserve the check name: ${renamed.name}`);
      replacements.push({ replaces, check });
    } else if (
      saved.length &&
      saved.every((item) => item.name === check.name) &&
      saved.some((item) => shell(item) !== shell(check))
    ) {
      // The same command stays one check: a stated shell corrects it, an omitted one keeps it.
      if (check.shell) replacements.push({ replaces: check.run, check });
    } else additional.push(check);
  }
  return {
    plan: integrationChecks({ ...op, checkReplacements: replacements }, additional),
    replacements,
  };
}
