import { describe, expect, it } from 'vitest';
import { updateInstallDirectory } from './update-target';

describe('update installation target', () => {
  it('pins Windows updates to the running executable, including paths with spaces', () => {
    expect(
      updateInstallDirectory(
        { os: 'win32', arch: 'x64' },
        true,
        'C:\\Users\\Owner\\AppData\\Local\\Programs\\Skaro\\Skaro.exe',
      ),
    ).toBe('C:\\Users\\Owner\\AppData\\Local\\Programs\\Skaro');
    expect(
      updateInstallDirectory(
        { os: 'win32', arch: 'arm64' },
        true,
        'D:\\Installed apps\\Skaro\\Skaro.exe',
      ),
    ).toBe('D:\\Installed apps\\Skaro');
  });
  it('does not enable installation into a development checkout or on another platform', () => {
    expect(
      updateInstallDirectory(
        { os: 'win32', arch: 'x64' },
        false,
        'C:\\repo\\node_modules\\electron\\electron.exe',
      ),
    ).toBeUndefined();
    expect(
      updateInstallDirectory({ os: 'linux', arch: 'x64' }, true, '/opt/skaro'),
    ).toBeUndefined();
  });
  it('rejects relative paths and a development runtime masquerading as an installed app', () => {
    for (const path of ['Skaro.exe', 'C:\\repo\\node_modules\\electron.exe'])
      expect(() => updateInstallDirectory({ os: 'win32', arch: 'x64' }, true, path)).toThrow();
  });
});
