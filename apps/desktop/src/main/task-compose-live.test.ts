import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import {
  environmentVariables,
  readEnvironment,
  runShell,
  type EnvironmentIdentity,
} from '@skaro/core';
import { admitCompose, describeCompose, readCompose } from './task-compose';
import { EnvironmentRegistry, type EnvironmentRecord } from './task-environment-registry';
import { refreshEnvironmentPorts } from './task-environment-ports';
import { systemDocker } from './task-environment-docker';

// Opt-in regression on real registered checkouts and their existing disposable databases.
// No substitute services, generated Compose project, seed or test data.
const profile = process.env.SKARO_LIVE_PROFILE;
const tasks = (process.env.SKARO_LIVE_TASKS ?? '').split(',').filter(Boolean);
it.runIf(!!profile && tasks.length >= 2)(
  'isolates admin ports in real task environments',
  async () => {
    const db = new DatabaseSync(join(profile!, 'skaro.db'));
    db.exec('PRAGMA busy_timeout = 3000');
    const registry = new EnvironmentRegistry({
      getSetting: <T>(key: string, fallback: T): T => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? (JSON.parse(String(row.value)) as T) : fallback;
      },
      setSetting: (key: string, value: unknown) => {
        if (key !== 'environments')
          throw new Error('Live check only updates environment allocations');
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(value), key);
      },
    });
    const contexts: { identity: EnvironmentIdentity; variables: Record<string, string> }[] = [];
    try {
      const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('environments')!;
      const records = JSON.parse(String(stored.value)) as EnvironmentRecord[];
      for (const taskId of tasks) {
        let record = records.find((value) => value.taskId === taskId)!;
        expect(record?.created, 'Use only already created real task data').toBe(true);
        await refreshEnvironmentPorts(registry, record, systemDocker);
        record = registry.find(record)!;
        const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(record.projectId)!;
        const root = String(project.path);
        const raw = parse(await readFile(join(root, '.skaro', 'config.yaml'), 'utf8'));
        const config = readEnvironment(raw.environment, [])!;
        const identity = {
          name: record.name,
          root,
          worktree: record.worktree ?? join(profile!, 'worktrees', record.projectId, record.taskId),
          ports: record.ports,
        };
        const compose = (await describeCompose(
          profile!,
          identity,
          environmentVariables(identity, config),
        ))!;
        const endpoints = await admitCompose(identity, compose);
        const admitted = await readCompose(identity.worktree, compose.variables);
        expect(admitted.services['backend-admin']?.ports ?? []).toEqual([]);
        expect(endpoints['backend-app/8000/tcp']).toBe(
          `127.0.0.1:${identity.ports.BACKEND_APP_PORT}`,
        );
        contexts.push({ identity, variables: compose.variables });
      }
      // Two real admin runtimes must coexist without either claiming their shared default 18001.
      for (const context of contexts) {
        await runShell('docker compose up -d --wait backend-admin', {
          cwd: context.identity.worktree,
          env: context.variables,
          timeoutMs: 180_000,
        });
      }
      for (const context of contexts) {
        await runShell(
          'docker compose exec -T backend-admin python -c "import urllib.request; print(urllib.request.urlopen(\'http://127.0.0.1:8000/admin/login/\').status)"',
          {
            cwd: context.identity.worktree,
            env: context.variables,
            timeoutMs: 30_000,
          },
        );
        await runShell(
          "docker compose exec -T backend-admin python manage.py shell --settings=chatballs_backend.settings_admin -c \"from django.db import connection; from django.core.cache import cache; connection.ensure_connection(); cache.set('skaro-port-verification', 'ok', 5); assert cache.get('skaro-port-verification') == 'ok'\"",
          { cwd: context.identity.worktree, env: context.variables, timeoutMs: 30_000 },
        );
        let services = '';
        await runShell('docker compose ps --format json', {
          cwd: context.identity.worktree,
          env: context.variables,
          timeoutMs: 30_000,
          output: (text) => {
            services = text;
          },
        });
        expect(services).toContain('backend-admin');
      }
    } finally {
      db.close();
      // Stop the exact real projects exercised above; keep their data for the agents.
      for (const context of contexts)
        await runShell('docker compose stop', {
          cwd: context.identity.worktree,
          env: context.variables,
          timeoutMs: 60_000,
        });
    }
  },
  480_000,
);
