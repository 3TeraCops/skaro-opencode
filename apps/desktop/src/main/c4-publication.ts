import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  prepareC4Package,
  realizeC4,
  c4Hash,
  type C4Package,
  type ProjectArtifacts,
} from '@skaro/core';
import type { ProjectContext } from './projects';

/** Architecture realization is committed and published by the same Git transaction as its code. */
export async function prepareC4Publication(
  context: ProjectContext,
  artifacts: ProjectArtifacts,
  realizedIds: string[],
): Promise<C4Package | undefined> {
  const realized = [...new Set(realizedIds)];
  if (!realized.length) return undefined;
  if (!artifacts.c4) throw new Error('Cannot publish architecture realization without a C4 model');
  const model = realizeC4(artifacts.c4, realized);
  model.revision++;
  // Current code paths are checked in the merged candidate, where all task results coexist.
  return prepareC4Package(context.root, {
    title: artifacts.c4.title,
    summary: `Published implementation of ${realized.join(', ')}`,
    baseRevision: artifacts.c4.revision,
    model,
    documents: [],
    locale: /Текущая архитектура|Планируемая архитектура/.test(artifacts.architecture?.body ?? '')
      ? 'ru'
      : 'en',
    deferCodeValidation: true,
  });
}

export function c4PublicationPaths(pkg: C4Package | undefined): string[] {
  return pkg
    ? [
        ...pkg.files.map((file) => `.skaro/${file.path}`),
        `.skaro/c4/history/${pkg.baseRevision + 1}.json`,
      ]
    : [];
}

export async function writeC4Publication(
  candidate: string,
  pkg: C4Package | undefined,
): Promise<string[]> {
  if (!pkg) return [];
  for (const file of pkg.files) {
    const path = join(candidate, '.skaro', file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.after);
  }
  const path = join(candidate, '.skaro/c4/history', `${pkg.baseRevision + 1}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ version: 1, package: pkg, hash: c4Hash(JSON.stringify(pkg)) }, null, 2) + '\n',
  );
  return c4PublicationPaths(pkg);
}
