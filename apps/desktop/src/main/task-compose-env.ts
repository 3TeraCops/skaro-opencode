import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EnvironmentIdentity } from '@skaro/core';

/** Attached shells discover later port declarations through a stable, non-secret env file. */
export async function composePortVariables(
  directory: string,
  identity: EnvironmentIdentity,
  variables: Record<string, string>,
): Promise<Record<string, string>> {
  const file = join(directory, 'ports.env');
  const content =
    Object.entries(identity.ports)
      .map(([name, port]) => `${name}=${port}`)
      .join('\n') + '\n';
  const previous = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (previous !== content) await writeFile(file, content);
  const explicit = variables.COMPOSE_ENV_FILES ?? process.env.COMPOSE_ENV_FILES;
  const disabled = variables.COMPOSE_DISABLE_ENV_FILE ?? process.env.COMPOSE_DISABLE_ENV_FILE;
  const defaultFile = join(identity.worktree, '.env');
  const files = explicit
    ? explicit
        .split(',')
        .filter(Boolean)
        .map((path) => resolve(identity.worktree, path))
    : !['1', 'true'].includes(disabled ?? '') && existsSync(defaultFile)
      ? [defaultFile]
      : [];
  if (file.includes(',')) throw new Error('Compose environment file path cannot contain a comma');
  return {
    ...variables,
    COMPOSE_ENV_FILES: [...files.filter((path) => path !== file), file].join(','),
  };
}
