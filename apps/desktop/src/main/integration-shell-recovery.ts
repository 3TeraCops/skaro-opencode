import type { IntegrationOperation } from './integration-model';
import { reviseIntegrationChecks } from './integration-checks';

/** Retry only the diagnosed legacy cmd/PowerShell defect once, on its retained candidate. */
export function recoverLegacyCheckShell(op: IntegrationOperation): boolean {
  if (
    process.platform !== 'win32' ||
    op.state !== 'failed' ||
    op.shellFailureRecovered ||
    op.error !== 'The resolver ended without a verified integration.'
  )
    return false;
  const failed = op.checkRuns?.findLast((check) => check.state === 'failed');
  if (!failed || failed.shell || failed.error) return false;
  const variable = /^(\$[A-Za-z_]\w*)\s*=\s*Get-ChildItem\b/.exec(failed.run)?.[1];
  if (!variable || !failed.output?.includes(`"${variable}"`)) return false;
  const revised = reviseIntegrationChecks(op, [
    {
      name: failed.name,
      run: failed.run,
      shell: 'powershell',
      replaces: failed.run,
    },
  ]);
  op.checkReplacements = revised.replacements;
  op.verificationPlan = revised.plan;
  op.verification = undefined;
  op.shellFailureRecovered = true;
  op.state = 'verifying';
  op.needsVerification = false;
  op.attempts = 0;
  return true;
}
