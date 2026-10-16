import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { repo, worktree, tasks, projectId, taskId, scope } from './task-run-test-support';

it('refreshes after file changes alone, keeping the card id and commit message', async () => {
  await writeFile(join(repo, 'feature.txt'), 'owner edits');
  await tasks.submitResult(
    {
      summary: 'Preserved runtime',
      commitMessage: 'retain this message',
      criteria: [{ number: 1, met: true, evidence: 'Real Git checkout' }],
    },
    scope(),
  );
  const card = async () =>
    (await tasks.open(projectId, taskId)).timeline?.interactions.find((i) => i.kind === 'merge');
  const initial = await card();
  expect(initial?.kind === 'merge' && initial.localChanges).toEqual(['feature.txt']);
  // Let the old HEAD/task-only cache settle; neither changes in this scenario.
  await new Promise((resolve) => setTimeout(resolve, 3_200));
  const incoming = await readFile(join(worktree, 'feature.txt'));
  await writeFile(join(repo, 'feature.txt'), incoming);
  const snapshot = async () => {
    const current = await card();
    return current?.kind === 'merge'
      ? { id: current.id, message: current.message, blockers: current.blockers }
      : undefined;
  };
  const expected = { id: initial!.id, message: 'retain this message', blockers: [] };
  await expect.poll(snapshot, { timeout: 10_000 }).toEqual(expected);
  await writeFile(join(repo, 'feature.txt'), 'new owner edit');
  await expect
    .poll(snapshot, { timeout: 10_000 })
    .toEqual({ ...expected, blockers: ['dirty_base'] });
  await writeFile(join(repo, 'feature.txt'), incoming);
  await expect.poll(snapshot, { timeout: 10_000 }).toEqual(expected);
}, 30_000);
