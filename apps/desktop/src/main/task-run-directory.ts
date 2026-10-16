import type { RunRecord } from '@skaro/core';
import { statSync } from 'node:fs';

/** An isolated run must never silently resume in the project's main working copy. */
export function taskRunDirectory(
  root: string,
  run: Pick<RunRecord, 'worktree' | 'taskId'>,
): string {
  if (!run.worktree) return root;
  let directory = false;
  try {
    directory = statSync(run.worktree).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
  }
  if (!directory)
    throw new Error(
      `Worktree for ${run.taskId} is missing: ${run.worktree}. The task cannot continue in the main working copy.`,
    );
  return run.worktree;
}
