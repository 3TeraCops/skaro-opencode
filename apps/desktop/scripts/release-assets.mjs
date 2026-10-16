import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SHA512 } from '../src/main/update-release.ts';
import { installerUrl } from '../src/main/update-locations.ts';

/** Validate the actual feeds and payloads before assembling or uploading a release. */
export async function releaseAssets(dir, manifest) {
  const assets = new Set();
  for (const selected of Object.values(manifest.platforms)) {
    const feed = parse(await readFile(join(dir, selected.feed), 'utf8'));
    if (feed?.version !== manifest.bundleVersion || feed.files?.length !== 1)
      throw new Error(`Invalid release feed: ${selected.feed}`);
    for (const file of feed.files) {
      if (
        file.url !== installerUrl(manifest.bundleVersion, selected.payload.name) ||
        !SHA512.test(file.sha512) ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0
      )
        throw new Error(`Invalid release payload in ${selected.feed}`);
      const payload = join(dir, selected.payload.name);
      if ((await stat(payload)).size !== file.size)
        throw new Error(`Release payload size mismatch: ${file.url}`);
      const hash = createHash('sha512');
      for await (const chunk of createReadStream(payload)) hash.update(chunk);
      if (hash.digest('base64') !== file.sha512)
        throw new Error(`Release payload SHA512 mismatch: ${file.url}`);
      assets.add(selected.payload.name);
    }
    const payload = feed.files[0];
    if (
      !payload ||
      payload.sha512 !== selected.payload.sha512 ||
      payload.size !== selected.payload.size
    )
      throw new Error(`Release feed does not match the manifest: ${selected.feed}`);
  }
  return [...assets].sort();
}
