import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash, git, type ProjectArtifacts } from '@skaro/core';

export const c4ReviewKey = (projectId: string, taskId: string) =>
  `c4.review.${projectId}.${taskId}`;

/** Includes staged, unstaged and untracked code, using the task's real Git checkout. */
export async function c4ChangeHash(root: string, baseHead: string, head?: string): Promise<string> {
  const diff = await git(root, [
    'diff',
    '--binary',
    baseHead,
    ...(head ? [head] : []),
    '--',
    '.',
    ':(exclude).skaro',
  ]);
  const others = head
    ? { stdout: '' }
    : await git(root, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
        ':(exclude).skaro',
      ]);
  const files = await Promise.all(
    others.stdout
      .split('\0')
      .filter(Boolean)
      .sort()
      .map(async (path) => [path, c4Hash((await readFile(join(root, path))).toString('base64'))]),
  );
  return c4Hash(JSON.stringify({ diff: diff.stdout, files }));
}

export function c4ArchitectureHash(artifacts: ProjectArtifacts): string {
  return c4Hash(JSON.stringify({ model: artifacts.c4, problems: artifacts.c4Problems }));
}
