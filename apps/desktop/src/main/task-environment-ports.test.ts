import { expect, it } from 'vitest';
import { COMPOSE_PROJECT } from '@skaro/core';
import { unavailablePorts } from './task-environment-ports';
import type { EnvironmentRecord } from './task-environment-registry';

it('repairs foreign occupancy but retains sockets owned by the running task', async () => {
  const record: EnvironmentRecord = {
    projectId: 'p',
    taskId: 'T-062',
    name: 'skaro-project-t-062',
    ports: { API_PORT: 20001, REDIS_PORT: 20002, UI_PORT: 20003 },
    created: true,
    usedAt: 0,
  };
  const container = {
    Id: 'own',
    Name: '/own',
    State: { Running: true },
    Mounts: [],
    Config: { Labels: { [COMPOSE_PROJECT]: record.name } },
    NetworkSettings: { Ports: { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '20001' }] } },
  };
  expect(await unavailablePorts(record, [container], async (port) => port === 20003)).toEqual([
    'REDIS_PORT',
  ]);
  expect(
    await unavailablePorts(
      record,
      [{ ...container, State: { Running: false } }],
      async () => false,
    ),
  ).toEqual(['API_PORT', 'REDIS_PORT', 'UI_PORT']);
  expect(
    await unavailablePorts(
      record,
      [{ ...container, Config: { Labels: { [COMPOSE_PROJECT]: 'other' } } }],
      async () => false,
    ),
  ).toEqual(['API_PORT', 'REDIS_PORT', 'UI_PORT']);
});
