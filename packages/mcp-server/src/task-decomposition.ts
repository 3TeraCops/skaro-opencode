/** Shared task boundaries for project chats, imports and planning tool descriptions. */
export const TASK_DECOMPOSITION_RULES = [
  '- Default to one task for a small, coherent change. Use the fewest tasks that deliver complete, verifiable outcomes.',
  '- Keep related implementation, necessary tests, documentation and verification of the same outcome in that task. Files, technical layers, individual requirements, acceptance criteria and checklist steps are not task boundaries.',
  '- Split only for independently useful outcomes, a concrete benefit from parallel execution, or scope too large for one bounded agent session. Keep tightly coupled sequential work together; do not combine unrelated outcomes into a giant task.',
  '- Each task can require its own agent session, branch, worktree, dependency setup, environment and integration checks. Weigh that cost before adding a task; grouping tasks into a milestone does not share their checkout or environment.',
  '- Before proposing or saving multiple tasks, consolidate pieces of the same outcome and explain the concrete reason for each remaining split in task notes. Use as many checkable acceptance criteria as the outcome needs; never split to meet a criterion count or a target task count.',
  '- Respect explicit user instructions about task boundaries. Do not silently regroup already created or accepted tasks; propose any replanning for owner approval.',
].join('\n');
