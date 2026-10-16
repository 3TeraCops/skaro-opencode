import type { AgentLimits } from '@skaro/timeline';

/** The most restrictive known subscription window; exactly 10% is not low. */
export function lowRemaining(snapshot: AgentLimits | undefined): number | undefined {
  const values =
    snapshot?.windows.flatMap(({ remainingPercent }) =>
      remainingPercent !== null &&
      Number.isFinite(remainingPercent) &&
      remainingPercent >= 0 &&
      remainingPercent < 10
        ? [remainingPercent]
        : [],
    ) ?? [];
  return values.length ? Math.min(...values) : undefined;
}

export function lowPercentLabel(remaining: number, locale: string): string {
  // A value below 10 must not round up to the non-warning threshold.
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      Math.floor(remaining * 10) / 10,
    ) + '%'
  );
}
