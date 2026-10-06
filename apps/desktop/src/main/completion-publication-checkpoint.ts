import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { captureFiles } from '../../../../packages/core/src/git/merge-files';
import type { CompletionFixture } from './completion-test-support';

/** A real Git/index checkpoint produced by the same commands used during publication. */
export async function publicationCheckpoint(fixture: CompletionFixture, published: boolean) {
  const task = await fixture.task('Publication recovery');
  await fixture.commit();
  const checkout = await fixture.checkout(task);
  await writeFile(join(checkout, 'feature.txt'), 'published candidate\n');
  await fixture.commit(checkout, 'candidate');
  const before = await fixture.context.git.head();
  const commit = await fixture.context.git.head(task.branch!);
  await writeFile(join(fixture.repo, 'README.md'), 'staged owner work\n');
  await git(fixture.repo, ['add', 'README.md']);
  await writeFile(join(fixture.repo, 'README.md'), 'unstaged owner work\n');
  const staged = (await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout;
  const unstaged = (await git(fixture.repo, ['diff', '--binary'])).stdout;
  const gitDir = (await git(fixture.repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const index = (
    await git(fixture.repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).stdout.trim();
  const directory = await mkdtemp(join(gitDir, 'skaro-merge-recovery-'));
  const original = await captureFiles(fixture.repo, ['feature.txt']);
  const planned = await captureFiles(checkout, ['feature.txt']);
  // The child has actually exited: recovery must never treat the current owner as dead.
  const ownerPid = await new Promise<number>((resolve, reject) => {
    execFile(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.pid))'],
      { windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(Number(stdout))),
    );
  });
  const lockOwner = `Skaro checkpoint ${ownerPid}`;
  await copyFile(index, join(directory, 'original-index'));
  await copyFile(index, join(directory, 'index'));
  const journal = {
    base: 'main',
    before,
    commit,
    ownerPid,
    lockOwner,
    original: [...original],
    planned: [...planned],
  };
  await writeFile(join(directory, 'journal.json'), JSON.stringify(journal));
  await writeFile(`${index}.lock`, lockOwner);
  await git(fixture.repo, ['read-tree', '-m', '-u', before, commit], {
    env: { GIT_INDEX_FILE: join(directory, 'index') },
  });
  if (published) await git(fixture.repo, ['update-ref', 'refs/heads/main', commit, before]);
  return { directory, journal, index, staged, unstaged };
}
