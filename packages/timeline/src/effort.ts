import type { AgentModel } from './agent.ts';

/** Skaro defaults to high; native model defaults must not silently select low. */
export function modelEffortDefault(model: AgentModel | undefined): string | undefined {
  if (!model) return undefined;
  return model.efforts.some((e) => e.id === 'high')
    ? 'high'
    : model.efforts.findLast((e) => e.id !== 'low')?.id;
}

/** Preserve an explicit supported choice, including low. */
export function selectedEffort(model: AgentModel | undefined, effort?: string): string | undefined {
  if (!model) return undefined;
  return effort && model.efforts.some((e) => e.id === effort) ? effort : modelEffortDefault(model);
}
