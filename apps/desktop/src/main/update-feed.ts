import { parse } from 'yaml';
import {
  RELEASE_API,
  RELEASE_ROOT,
  parseRelease,
  releasePlatform,
  SHA512,
  type ReleaseManifest,
  STABLE_VERSION,
} from './update-release';
import { installerUrl, updateFeedBase } from './update-locations';
import type { Platform } from '@skaro/core';

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

async function request(url: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Update feed: HTTP ${response.status}`);
  return response;
}

/** Installer assets belong to the stable release; metadata lives in the updates branch. */
export async function fetchRelease(
  platform: Platform,
  fetcher: typeof fetch,
): Promise<ReleaseManifest | undefined> {
  const response = await fetcher(RELEASE_API, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
  const release = (await response.json()) as GitHubRelease;
  if (release.draft || release.prerelease) return undefined;
  const base = `${RELEASE_ROOT}/download/${release.tag_name}/`;
  const asset = (name: string) => {
    const found = release.assets?.find((a) => a.name === name);
    if (!found || found.browser_download_url !== base + encodeURIComponent(name))
      throw new Error(`Release asset missing: ${name}`);
    return found.browser_download_url;
  };
  const version = release.tag_name.replace(/^v/, '');
  if (release.tag_name !== `v${version}` || !STABLE_VERSION.test(version)) return undefined;
  const metadata = updateFeedBase(version);
  const manifestResponse = await fetcher(`${metadata}skaro-release.json`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (manifestResponse.status === 404) return undefined;
  if (!manifestResponse.ok) throw new Error(`Update manifest: HTTP ${manifestResponse.status}`);
  const manifest = parseRelease(await manifestResponse.json());
  if (release.tag_name !== `v${manifest.bundleVersion}`)
    throw new Error('Release tag does not match the bundle');
  const selected = releasePlatform(manifest, platform);
  asset(selected.payload.name);
  const feed = parse(await (await request(metadata + selected.feed, fetcher)).text()) as {
    version?: string;
    files?: { url: string; sha512: string; size: number }[];
  };
  if (feed?.version !== manifest.bundleVersion || !feed.files?.length)
    throw new Error('Update feed does not match the bundle');
  for (const file of feed.files) {
    if (!file || !SHA512.test(file.sha512) || !Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error('Invalid update payload integrity');
    if (file.url !== installerUrl(version, selected.payload.name))
      throw new Error('Unexpected update installer URL');
  }
  const payload = feed.files.find((f) => f.url === installerUrl(version, selected.payload.name));
  if (
    !payload ||
    payload.sha512 !== selected.payload.sha512 ||
    payload.size !== selected.payload.size
  )
    throw new Error('Update payload does not match the manifest');
  return manifest;
}
