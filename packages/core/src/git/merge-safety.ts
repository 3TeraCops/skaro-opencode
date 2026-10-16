import { git } from './command.ts';
import { identicalUntrackedAdditions } from './merge-identical.ts';

const paths = (output: string) => output.split('\0').filter(Boolean);
const overlaps = (first: string, second: string) => {
  const a = process.platform === 'win32' ? first.toLowerCase() : first;
  const b = process.platform === 'win32' ? second.toLowerCase() : second;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

/** Both sides of staging matter, even when a working file was restored to HEAD. */
export async function localMergeObstacles(
  repo: string,
  before: string,
  target: string,
  managed: readonly string[] = [],
): Promise<string[]> {
  const changed = paths(
    (await git(repo, ['diff', '--name-only', '--no-renames', '-z', before, target])).stdout,
  ).filter((path) => !managed.includes(path));
  if (!changed.length) return [];
  const [unstaged, staged, untracked] = await Promise.all([
    git(repo, ['diff', '--name-only', '--no-renames', '-z']),
    git(repo, ['diff', '--cached', '--name-only', '--no-renames', '-z']),
    git(repo, ['ls-files', '--others', '-z']),
  ]);
  const affected = (path: string) => changed.some((changedPath) => overlaps(path, changedPath));
  const tracked = new Set([...paths(unstaged.stdout), ...paths(staged.stdout)].filter(affected));
  const newPaths = paths(untracked.stdout).filter(affected);
  const identical = new Set(await identicalUntrackedAdditions(repo, before, target, newPaths));
  return [...new Set([...tracked, ...newPaths.filter((path) => !identical.has(path))])].sort();
}
