import { expect, it } from 'vitest';
import { assertManagedPorts, managedPortPlan } from './task-compose-ports';

it('keeps allocated loopback bindings and makes undeclared services internal', () => {
  const ports = { API_PORT: 20001, UI_PORT: 20002 };
  const plan = managedPortPlan(
    {
      services: {
        api: { ports: [{ target: 8000, published: '20001', host_ip: '0.0.0.0' }] },
        ui: { ports: [{ target: 5173, published: '20002' }] },
        admin: { ports: [{ target: 8000, published: '18001', host_ip: '127.0.0.1' }] },
        gateway: {
          ports: [
            { target: 80, published: '80' },
            { target: 443, published: '443' },
          ],
        },
        worker: {},
      },
    },
    ports,
  );
  expect(plan.services.admin?.ports).toEqual([]);
  expect(plan.services.gateway?.ports).toEqual([]);
  expect(plan.services.worker).toBeUndefined();
  expect(plan.services.api?.ports).toEqual([
    { target: 8000, published: '20001', host_ip: '127.0.0.1' },
  ]);
  expect(plan.endpoints).toEqual({
    'api/8000/tcp': '127.0.0.1:20001',
    'ui/5173/tcp': '127.0.0.1:20002',
  });
  expect(() => assertManagedPorts({ services: plan.services }, ports)).not.toThrow();
  expect(() =>
    assertManagedPorts(
      { services: { admin: { ports: [{ target: 8000, published: '18001' }] } } },
      ports,
    ),
  ).toThrow('unmanaged host port');
});

it('supports both protocols but rejects two services sharing the same allocated socket', () => {
  const ports = { MEDIA_PORT: 20003 };
  const binding = { target: 3478, published: '20003' };
  expect(
    managedPortPlan(
      { services: { media: { ports: [binding, { ...binding, protocol: 'udp' }] } } },
      ports,
    ).services.media?.ports,
  ).toHaveLength(2);
  expect(() =>
    managedPortPlan(
      { services: { first: { ports: [binding] }, second: { ports: [binding] } } },
      ports,
    ),
  ).toThrow('shared by multiple services');
});
