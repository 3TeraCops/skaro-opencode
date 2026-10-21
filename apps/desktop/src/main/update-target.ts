import { win32 } from 'node:path';
import type { Platform } from '@skaro/core';

/** NSIS must update the current application, even if another install changed the registry. */
export function updateInstallDirectory(
  platform: Platform,
  packaged: boolean,
  executable: string,
): string | undefined {
  if (!packaged || platform.os !== 'win32') return undefined;
  if (!win32.isAbsolute(executable) || win32.basename(executable).toLowerCase() !== 'skaro.exe')
    throw new Error('Invalid installed Skaro executable');
  return win32.dirname(executable);
}
