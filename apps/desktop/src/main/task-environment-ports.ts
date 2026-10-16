import { portIsFree, type DockerContainer, type TaskKey } from '@skaro/core';
import { namedContainers, type EnvironmentDocker } from './task-environment-docker';
import type { EnvironmentRecord, EnvironmentRegistry } from './task-environment-registry';

/** A running service keeps its own port; stopped containers do not reserve host sockets. */
export async function unavailablePorts(
  record: EnvironmentRecord,
  containers: DockerContainer[],
  free: (port: number) => Promise<boolean> = portIsFree,
): Promise<string[]> {
  const running = namedContainers(containers, record.name).filter(
    (container) => container.State?.Running,
  );
  const held = new Set(
    running.flatMap((container) =>
      Object.values(container.NetworkSettings?.Ports ?? {}).flatMap((bindings) =>
        (bindings ?? []).map((binding) => Number(binding.HostPort)),
      ),
    ),
  );
  const checks = await Promise.all(
    Object.entries(record.ports).map(async ([name, port]) =>
      !held.has(port) && !(await free(port)) ? name : undefined,
    ),
  );
  return checks.filter((name): name is string => name !== undefined);
}

/** Executed under the allocation queue, immediately before Compose admission/start. */
export async function refreshEnvironmentPorts(
  registry: EnvironmentRegistry,
  key: TaskKey,
  docker: EnvironmentDocker,
): Promise<void> {
  const record = registry.find(key)!;
  const missing = await unavailablePorts(record, await docker.inspect());
  if (!missing.length) return;
  const replacements = await docker.ports(missing.length, registry.takenPorts());
  registry.update(key, {
    previousPorts: {
      ...record.previousPorts,
      ...Object.fromEntries(
        missing.map((name) => [
          name,
          [...new Set([...(record.previousPorts?.[name] ?? []), record.ports[name]!])],
        ]),
      ),
    },
    ports: {
      ...record.ports,
      ...Object.fromEntries(missing.map((name, index) => [name, replacements[index]!])),
    },
  });
}
