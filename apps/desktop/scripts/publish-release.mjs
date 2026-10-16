import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { bundleMetadata, desktop } from './bundle-metadata.mjs';
import { mergeReleaseParts, newer, parseRelease } from '../src/main/update-release.ts';
import { releaseAssets } from './release-assets.mjs';
import { publishUpdateFeed } from './publish-update-feed.mjs';
import { installerUrl } from '../src/main/update-locations.ts';

// This command is intentionally restricted to an explicitly requested Actions run.
const repository = 'dartdavros/skaro';
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_REPOSITORY !== repository ||
  process.env.SKARO_PUBLISH_RELEASE !== 'true' ||
  process.env.GITHUB_REF !== 'refs/heads/main' ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
)
  throw new Error('Publication requires an explicit release run in dartdavros/skaro');
if (!process.env.SKARO_BUNDLE_VERSION || !process.env.SKARO_PRODUCT_VERSION)
  throw new Error('Release versions must be supplied explicitly');

const dir = join(desktop, 'release');
const manifest = parseRelease(JSON.parse(await readFile(join(dir, 'skaro-release.json'), 'utf8')));
const parts = Object.entries(manifest.platforms).map(([key, value]) => ({
  ...manifest,
  platforms: { [key]: value },
}));
mergeReleaseParts(await bundleMetadata(), parts);
const assets = await releaseAssets(dir, manifest);
const sizes = await Promise.all(
  assets.map(async (name) => [name, (await stat(join(dir, name))).size]),
);
const tag = `v${manifest.bundleVersion}`;
const notes = join(dir, 'release-notes.md');
await writeFile(
  notes,
  [
    `Skaro ${manifest.skaroVersion} (bundle ${manifest.bundleVersion}).`,
    '',
    'Installers for Windows, macOS and Linux (x64 / arm64).',
    '',
    '| System | x64 | arm64 |',
    '| --- | --- | --- |',
    ...[
      ['Windows', 'win32'],
      ['macOS', 'darwin'],
      ['Linux', 'linux'],
    ].map(([label, os]) => {
      const link = (arch) => {
        const name = manifest.platforms[`${os}-${arch}`].payload.name;
        return `[Download](${installerUrl(manifest.bundleVersion, name)})`;
      };
      return `| ${label} | ${link('x64')} | ${link('arm64')} |`;
    }),
    '',
    'These builds have no publisher signature or notarization. Windows may show an unknown-publisher warning; macOS may block the first launch.',
    'macOS uses an ad-hoc signature only. Install macOS updates manually; automatic updates require a Developer ID signature.',
    '',
    'Download the installer matching your system below. Update metadata is stored separately in the updates branch.',
    'Upgrading from 2.0.2: install this version manually once to switch to the new update feed. Windows/Linux then use full installer downloads with SHA512 verification.',
    '',
    `Source commit: ${process.env.GITHUB_SHA}`,
    '',
  ].join('\n'),
);
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let latest;
try {
  latest = JSON.parse(gh('api', `repos/${repository}/releases/latest`));
} catch (error) {
  if (!String(error.stderr).includes('(HTTP 404)')) throw error;
}
if (latest && !newer(manifest.bundleVersion, latest.tag_name.replace(/^v/, '')))
  throw new Error(`Bundle version must be newer than ${latest.tag_name}`);
// Creating the ref fails if the tag already exists; never reuse or move an old release tag.
gh(
  'api',
  `repos/${repository}/git/refs`,
  '--method',
  'POST',
  '-f',
  `ref=refs/tags/${tag}`,
  '-f',
  `sha=${process.env.GITHUB_SHA}`,
);
gh(
  'release',
  'create',
  tag,
  '--repo',
  repository,
  '--verify-tag',
  '--draft',
  '--title',
  `Skaro ${manifest.skaroVersion}`,
  '--notes-file',
  notes,
);
gh('release', 'upload', tag, '--repo', repository, ...assets.map((name) => join(dir, name)));
const uploaded = JSON.parse(gh('release', 'view', tag, '--repo', repository, '--json', 'assets'));
const expected = Object.fromEntries(sizes);
const actual = Object.fromEntries(uploaded.assets.map((asset) => [asset.name, asset.size]));
if (!isDeepStrictEqual(actual, expected))
  throw new Error(
    'Uploaded release assets differ from the verified bundle; release remains a draft',
  );
await publishUpdateFeed(dir, manifest);
gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--latest');
process.stdout.write(`Published https://github.com/${repository}/releases/tag/${tag}\n`);
