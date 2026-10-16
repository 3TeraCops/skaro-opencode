import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const repository = 'dartdavros/skaro';
function api(path, body) {
  return JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${repository}/${path}`, ...(body ? ['--method', 'POST', '--input', '-'] : [])],
      { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined },
    ),
  );
}

/** A small orphan branch holds immutable version folders; no installers or source tree. */
export async function publishUpdateFeed(dir, manifest) {
  let previous;
  try {
    previous = api('git/ref/heads/updates').object.sha;
  } catch (error) {
    if (!String(error.stderr).includes('(HTTP 404)')) throw error;
  }
  const tag = `v${manifest.bundleVersion}`;
  const names = ['skaro-release.json', ...Object.values(manifest.platforms).map((p) => p.feed)];
  let base;
  if (previous) {
    base = api(`git/commits/${previous}`).tree.sha;
    if (api(`git/trees/${base}`).tree.some((entry) => entry.path === tag))
      throw new Error(`Update metadata already exists for ${tag}`);
  }
  const tree = await Promise.all(
    names.map(async (name) => ({
      path: `${tag}/${name}`,
      mode: '100644',
      type: 'blob',
      content: await readFile(join(dir, name), 'utf8'),
    })),
  );
  const created = api('git/trees', { ...(base ? { base_tree: base } : {}), tree });
  const commit = api('git/commits', {
    message: `:bookmark: chore(updates): publish ${tag} metadata`,
    tree: created.sha,
    parents: previous ? [previous] : [],
  });
  if (previous) {
    execFileSync('gh', [
      'api',
      `repos/${repository}/git/refs/heads/updates`,
      '--method',
      'PATCH',
      '-f',
      `sha=${commit.sha}`,
      '-F',
      'force=false',
    ]);
  } else api('git/refs', { ref: 'refs/heads/updates', sha: commit.sha });
  // Read the committed files back before exposing the stable release.
  for (const entry of tree) {
    const uploaded = api(`contents/${entry.path}?ref=${commit.sha}`);
    if (Buffer.from(uploaded.content, 'base64').toString('utf8') !== entry.content)
      throw new Error(`Published update metadata differs: ${entry.path}`);
  }
}
