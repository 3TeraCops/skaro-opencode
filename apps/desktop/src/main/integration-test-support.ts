import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { CompletionFixture } from './completion-test-support';
import type { IntegrationOperation } from './integration-model';

/** Actual conflicting accepted branches in the existing owner-authorized Git/SQLite harness. */
export async function conflictingResults(f: CompletionFixture) {
  const stage = await f.context.store.createMilestone({ title: 'Integration' });
  const first = await f.task('First behavior', stage.id);
  const second = await f.task('Second behavior', stage.id);
  await f.commit();
  const before = await f.context.git.head();
  const a = await f.checkout(first),
    b = await f.checkout(second);
  await f.accept(first, a, 'shared.txt');
  await f.accept(second, b, 'shared.txt');
  const results = [f.journal.result(first.id)!, f.journal.result(second.id)!];
  return { stage, first, second, a, b, before, results };
}

export async function stageResolution(op: IntegrationOperation) {
  await writeFile(join(op.worktree, 'shared.txt'), 'both accepted behaviors\n');
  await git(op.worktree, ['add', 'shared.txt']);
}

export const behaviorCheck = {
  name: 'both accepted behaviors',
  run: `node -e "if(require('fs').readFileSync('shared.txt','utf8')!=='both accepted behaviors\\n')process.exit(1)"`,
};
