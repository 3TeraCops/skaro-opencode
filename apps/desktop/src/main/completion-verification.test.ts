import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';

let fixture: CompletionFixture;
beforeEach(async () => {
  fixture = await CompletionFixture.create();
});
afterEach(async () => {
  await fixture.close();
});

it('accepts another task while a real merge check is still running and preserves its review metadata', async () => {
  const first = await fixture.task('Being checked');
  const second = await fixture.task('Completes in parallel');
  const marker = join(fixture.root, 'checking');
  const release = join(fixture.root, 'release-check');
  await writeFile(
    join(fixture.repo, 'check.cjs'),
    `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)}, 'checking');
const poll = () => fs.existsSync(${JSON.stringify(release)}) ? process.exit(0) : setTimeout(poll, 10);
poll(); setTimeout(() => process.exit(17), 15000);
`,
  );
  const config = (await fixture.context.load()).config;
  await fixture.context.store.writeConfig({
    ...config,
    checks: [{ name: 'real check', run: 'node check.cjs' }],
  });
  await fixture.commit();
  const a = await fixture.checkout(first);
  const b = await fixture.checkout(second);
  await fixture.accept(first, a);
  const merging = fixture.coordinator.merge(fixture.projectId, first.id);
  let accepting: Promise<void> | undefined;
  try {
    await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true);
    accepting = fixture.accept(second, b);
    await expect
      .poll(() => fixture.journal.result(second.id)?.head, { timeout: 5_000 })
      .toBeDefined();
    await accepting;
    expect((await fixture.context.store.readTask(first.id)).status).toBe('review');
    expect((await fixture.context.store.readTask(second.id)).status).toBe('review');
  } finally {
    await writeFile(release, 'continue');
    await merging;
    await accepting;
  }
  expect((await fixture.context.store.readTask(first.id)).status).toBe('done');
  expect((await fixture.context.store.readTask(second.id)).status).toBe('review');
  expect(fixture.db.listMerges(fixture.projectId, second.id)).toEqual([]);
}, 30_000);

it('blocks publication when an owner verification input changes during a real check', async () => {
  const task = await fixture.task('Guard inputs');
  const path = join(fixture.repo, '.skaro', 'config.yaml');
  await writeFile(
    join(fixture.repo, 'check.cjs'),
    `require('node:fs').appendFileSync(${JSON.stringify(path)}, '# owner change during check\\n');\n`,
  );
  const config = (await fixture.context.load()).config;
  await fixture.context.store.writeConfig({
    ...config,
    checks: [{ name: 'real check', run: 'node check.cjs' }],
  });
  await fixture.commit();
  await fixture.accept(task, await fixture.checkout(task));
  const before = await fixture.context.git.head();
  await expect(fixture.coordinator.merge(fixture.projectId, task.id)).rejects.toThrow(
    'metadata changed',
  );
  expect(await fixture.context.git.head()).toBe(before);
  expect((await fixture.context.store.readTask(task.id)).status).toBe('review');
  expect(await readFile(path, 'utf8')).toContain('# owner change during check');
  expect(fixture.db.listMerges(fixture.projectId, task.id)).toEqual([]);
}, 30_000);
