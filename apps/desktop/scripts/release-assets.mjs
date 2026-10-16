import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SHA512 } from '../src/main/update-release.ts';

/** Validate the actual feeds and payloads before assembling or uploading a release. */
export async function releaseAssets(dir, manifest) {
  const assets = new Set(['skaro-release.json']);
  for (const [platform, selected] of Object.entries(manifest.platforms)) {
    const feed = parse(await readFile(join(dir, selected.feed), 'utf8'));
    if (feed?.version !== manifest.bundleVersion || !feed.files?.length)
      throw new Error(`Invalid release feed: ${selected.feed}`);
    assets.add(selected.feed);
    for (const file of feed.files) {
      if (
        !/^[\w .-]+\.(exe|dmg|zip|AppImage)$/.test(file.url) ||
        !SHA512.test(file.sha512) ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0
      )
        throw new Error(`Invalid release payload in ${selected.feed}`);
      const payload = join(dir, file.url);
      if ((await stat(payload)).size !== file.size)
        throw new Error(`Release payload size mismatch: ${file.url}`);
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(payload)) hash.update(chunk);
      if (hash.digest('base64') !== file.sha512)
        throw new Error(`Release payload SHA512 mismatch: ${file.url}`);
      assets.add(file.url);
      if (platform.startsWith('win32-') || file.url.endsWith('.zip')) {
        const blockmap = `${file.url}.blockmap`;
        if (!(await stat(join(dir, blockmap))).size)
          throw new Error(`Empty release blockmap: ${blockmap}`);
        assets.add(blockmap);
      }
    }
    const payload = feed.files.find((file) => file.url === selected.payload.name);
    if (
      !payload ||
      payload.sha512 !== selected.payload.sha512 ||
      payload.size !== selected.payload.size
    )
      throw new Error(`Release feed does not match the manifest: ${selected.feed}`);
  }
  return [...assets].sort();
}
