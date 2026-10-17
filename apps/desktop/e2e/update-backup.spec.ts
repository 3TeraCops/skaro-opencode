import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { launchApp } from './launch';

/** Real installed application as input; no generated archive, fake executable or update server. */
test('backs up the physical packaged app and cleans up a failed attempt', async () => {
  const info = test.info();
  const executable = process.env['SKARO_E2E_BACKUP_EXECUTABLE'];
  test.skip(!executable || process.platform === 'linux', 'Requires a real installed NSIS / .app');
  const source =
    process.platform === 'darwin' ? resolve(dirname(executable!), '../..') : dirname(executable!);
  const archive =
    process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar';
  expect((await stat(join(source, archive))).isFile()).toBe(true);
  const helperSource = resolve(__dirname, '../src/main/update-backup.ts');
  const helper = info.outputPath('update-backup.cjs');
  await mkdir(dirname(helper), { recursive: true });
  // Compile the production helper for execution inside the real Electron main process.
  const compiled = await transformWithEsbuild(await readFile(helperSource, 'utf8'), helperSource, {
    format: 'cjs',
    target: 'node24',
  });
  await writeFile(helper, compiled.code);
  const app = await launchApp();
  try {
    const backup = await app.evaluate(
      async ({ app }, options) => {
        const require = process
          .getBuiltinModule('node:module')!
          .createRequire(`${app.getAppPath()}/package.json`);
        const { backupApplication } = require(
          options.helper,
        ) as typeof import('../src/main/update-backup');
        return backupApplication(options.root, app.getVersion(), options.executable, {
          os: process.platform === 'darwin' ? 'darwin' : 'win32',
          arch: process.arch,
        });
      },
      { helper, root: info.outputPath('successful'), executable: executable! },
    );
    expect((await stat(join(backup, archive))).isFile()).toBe(true);
    const hash = async (path: string) =>
      createHash('sha512')
        .update(await readFile(path))
        .digest('hex');
    expect(await hash(join(backup, archive))).toBe(await hash(join(source, archive)));
    expect(await hash(join(backup, relative(source, executable!)))).toBe(await hash(executable!));

    const failedRoot = info.outputPath('failed');
    const failure = await app.evaluate(
      async ({ app }, options) => {
        const require = process
          .getBuiltinModule('node:module')!
          .createRequire(`${app.getAppPath()}/package.json`);
        const { backupApplication } = require(
          options.helper,
        ) as typeof import('../src/main/update-backup');
        try {
          await backupApplication(options.root, app.getVersion(), options.executable, {
            os: process.platform === 'darwin' ? 'darwin' : 'win32',
            arch: process.arch,
          });
          return undefined;
        } catch (error) {
          return (error as Error).message;
        }
      },
      {
        helper,
        root: failedRoot,
        executable: info.outputPath('missing/application/Contents/MacOS/Skaro'),
      },
    );
    expect(failure).toContain('Could not create application backup:');
    expect(failure).toContain('ENOENT');
    expect(await readdir(join(failedRoot, 'previous'))).toEqual([]);
  } finally {
    await app.close();
  }
});
