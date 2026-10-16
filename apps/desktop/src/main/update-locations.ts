import { RELEASE_ROOT, STABLE_VERSION } from './update-release.ts';

export function updateFeedBase(version: string): string {
  if (!STABLE_VERSION.test(version)) throw new Error('Invalid update version');
  return `https://raw.githubusercontent.com/dartdavros/skaro/updates/v${version}/`;
}

export function installerUrl(version: string, name: string): string {
  if (!STABLE_VERSION.test(version) || !/^[\w .-]+\.(exe|dmg|AppImage)$/.test(name))
    throw new Error('Invalid installer location');
  return `${RELEASE_ROOT}/download/v${version}/${encodeURIComponent(name)}`;
}
