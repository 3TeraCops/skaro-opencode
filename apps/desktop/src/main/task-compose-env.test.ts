import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { composePortVariables } from './task-compose-env';
import { dir, repo } from './task-run-test-support';

// Uses the authorized real Git test workspace; no backend or HTTP substitute.
it('preserves project env files and exposes later allocations through the attached shell path', async () => {
  const identity = {
    name: 'skaro-project-t-062',
    root: repo,
    worktree: repo,
    ports: { API_PORT: 20001 },
  };
  const original = { COMPOSE_ENV_FILES: 'config.env,local.env', API_PORT: '20001' };
  const attached = await composePortVariables(dir, identity, original);
  expect(attached.COMPOSE_ENV_FILES).toBe(
    [join(repo, 'config.env'), join(repo, 'local.env'), join(dir, 'ports.env')].join(','),
  );
  const updated = await composePortVariables(
    dir,
    { ...identity, ports: { API_PORT: 20002, ADMIN_PORT: 20003 } },
    attached,
  );
  expect(updated.COMPOSE_ENV_FILES).toBe(attached.COMPOSE_ENV_FILES);
  expect(await readFile(join(dir, 'ports.env'), 'utf8')).toBe('API_PORT=20002\nADMIN_PORT=20003\n');
  expect(updated.COMPOSE_ENV_FILES?.split(',')).toHaveLength(3);
});
