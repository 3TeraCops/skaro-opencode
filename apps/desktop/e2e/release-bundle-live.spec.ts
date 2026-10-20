import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const version = process.env['SKARO_RELEASE_VERIFY_VERSION'];
test.skip(
  !profile || !version || process.env['SKARO_E2E_PACKAGED'] !== '1',
  'Packaged release only',
);

test('runs the exact built main from ASAR with matching release metadata and updater', async ({
  browserName: _browserName,
}) => {
  const expected = createHash('sha256')
    .update(await readFile(join(__dirname, '../out/main/index.js')))
    .digest('hex');
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const actual = await app.evaluate(({ app }) => {
      const { readFileSync } = process.getBuiltinModule('fs');
      const { join } = process.getBuiltinModule('path');
      const { createHash } = process.getBuiltinModule('crypto');
      return {
        packaged: app.isPackaged,
        version: app.getVersion(),
        path: app.getAppPath(),
        metadata: JSON.parse(
          readFileSync(join(process.resourcesPath, 'skaro-bundle.json'), 'utf8'),
        ),
        hash: createHash('sha256')
          .update(readFileSync(join(app.getAppPath(), 'out/main/index.js')))
          .digest('hex'),
      };
    });
    expect(actual.packaged).toBe(true);
    expect(actual.path).toMatch(/app\.asar$/);
    expect(actual.version).toBe(version);
    expect(actual.metadata.bundleVersion).toBe(version);
    expect(actual.metadata.skaroVersion).toBe(version);
    expect(actual.hash).toBe(expected);
    const page = await app.firstWindow();
    await expect(page.locator('.project-nav')).toBeVisible();
    const updates = await page.evaluate(() => window.skaro.invoke('updates.state'));
    expect(updates.current).toBe(version);
    expect(updates.installable).toBe(process.platform === 'win32' || !!process.env['APPIMAGE']);
    console.log('Actual packaged bundle:', JSON.stringify({ ...actual, updates }));
  } finally {
    await app.close();
  }
});
