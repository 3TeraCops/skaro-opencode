import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { git } from './command.ts';
import { fileImage } from './merge-files.ts';

/** Only new regular files may be adopted; staged edits and path/type collisions stay blocked. */
export async function identicalUntrackedAdditions(
  repo: string,
  before: string,
  target: string,
  untracked: readonly string[],
): Promise<string[]> {
  if (!untracked.length) return [];
  const candidates = new Set(untracked);
  const entries = (
    await git(repo, [
      'diff',
      '--raw',
      '--no-abbrev',
      '--no-renames',
      '--diff-filter=A',
      '-z',
      before,
      target,
    ])
  ).stdout.split('\0');
  const checkMode =
    (await git(repo, ['config', '--bool', 'core.filemode'], { allowFail: true })).stdout.trim() !==
    'false';
  const identical: string[] = [];
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const path = entries[i + 1]!;
    if (!candidates.has(path)) continue;
    const [, mode, , object] = entries[i]!.split(' ');
    if (mode !== '100644' && mode !== '100755') continue;
    const image = await fileImage(join(repo, path));
    if (image.kind !== 'file') continue;
    if (checkMode && Boolean(image.mode & 0o111) !== (mode === '100755')) continue;
    const data = Buffer.from(image.data, 'base64');
    const hash = createHash(object!.length === 64 ? 'sha256' : 'sha1')
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest('hex');
    if (hash === object) identical.push(path);
  }
  return identical;
}
