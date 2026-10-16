import type { IntegrationOperation } from './integration-model';

const GENERIC_FAILURE = 'The resolver ended without a verified integration.';

/** The account stopped the turn: signing in or the limit reset fixes it, a repeat does not. */
export class IntegrationAgentUnavailable extends Error {}

/** A resolver ending its turn must not erase the actual verification failure. */
export function integrationFailure(op: IntegrationOperation): string {
  if (op.error && op.error !== GENERIC_FAILURE) return op.error;
  const failed = op.checkRuns?.findLast((check) => check.state === 'failed');
  if (failed?.error) return failed.error;
  if (failed) return `${failed.name}: verification failed\n${failed.output?.trim() || failed.run}`;
  return GENERIC_FAILURE;
}
