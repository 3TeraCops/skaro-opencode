import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { publicationCheckpoint } from './completion-publication-checkpoint';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it.each([false, true])(
  'recovers an interrupted Git publication with ref updated=%s',
  async (published) => {
    const checkpoint = await publicationCheckpoint(fixture, published);
    await fixture.restart();
    await fixture.context.git.recoverPublication();
    expect(await fixture.context.git.head()).toBe(
      published ? checkpoint.journal.commit : checkpoint.journal.before,
    );
    expect(existsSync(join(fixture.repo, 'feature.txt'))).toBe(published);
    expect((await git(fixture.repo, ['diff', '--cached', '--binary'])).stdout).toBe(
      checkpoint.staged,
    );
    expect((await git(fixture.repo, ['diff', '--binary'])).stdout).toBe(checkpoint.unstaged);
    expect(existsSync(`${checkpoint.index}.lock`)).toBe(false);
    expect(existsSync(checkpoint.directory)).toBe(false);
    await fixture.context.git.recoverPublication();
  },
  30_000,
);

it('retains recovery files and owner edits when the crashed publication was changed afterwards', async () => {
  const checkpoint = await publicationCheckpoint(fixture, true);
  const index = await readFile(checkpoint.index);
  await writeFile(join(fixture.repo, 'feature.txt'), 'new owner work after crash\n');
  await expect(fixture.context.git.recoverPublication()).rejects.toThrow('needs recovery');
  expect(await fixture.context.git.head()).toBe(checkpoint.journal.commit);
  expect(await readFile(checkpoint.index)).toEqual(index);
  expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe(
    'new owner work after crash\n',
  );
  expect(existsSync(checkpoint.directory)).toBe(true);
}, 30_000);

it('does not recover or remove the index lock of a living publication owner', async () => {
  const checkpoint = await publicationCheckpoint(fixture, true);
  await writeFile(
    join(checkpoint.directory, 'journal.json'),
    JSON.stringify({ ...checkpoint.journal, ownerPid: process.pid }),
  );
  await expect(fixture.context.git.recoverPublication()).rejects.toThrow('needs recovery');
  expect(existsSync(`${checkpoint.index}.lock`)).toBe(true);
  expect(existsSync(checkpoint.directory)).toBe(true);
}, 30_000);
