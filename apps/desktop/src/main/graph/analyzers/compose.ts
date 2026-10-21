import { parse } from 'yaml';
import type { Facts, SourceFile } from '../facts';
import { posix } from 'node:path';

export function analyzeCompose(file: SourceFile, facts: Facts): void {
  if (!/(^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/.test(file.path)) return;
  const model = parse(file.text, { maxAliasCount: 30 }) as {
    services?: Record<string, Record<string, unknown>>;
  } | null;
  if (!model?.services || typeof model.services !== 'object') return;
  for (const [name, service] of Object.entries(model.services)) {
    const id = `service:${file.path}:${name}`;
    // Only topology metadata is copied. Environment, build args, secrets and credential-bearing URLs are excluded.
    const ports = Array.isArray(service.ports)
      ? service.ports
          .filter(
            (port): port is string | number => typeof port === 'number' || typeof port === 'string',
          )
          .map(String)
      : [];
    const networks = Array.isArray(service.networks)
      ? service.networks.filter((network): network is string => typeof network === 'string')
      : Object.keys((service.networks ?? {}) as object);
    facts.node({
      id,
      kind: 'service',
      name,
      origin: 'extracted-code',
      sources: [facts.ref(file)],
      attributes: { language: 'compose', ports, networks },
    });
    facts.edge(
      `file:${file.path}`,
      id,
      'contains',
      facts.ref(file),
      'compose/service',
      'Service explicitly declared in this Compose file',
      'extracted-code',
      'explicit',
    );
  }
  for (const [name, service] of Object.entries(model.services)) {
    const dependencies = Array.isArray(service.depends_on)
      ? service.depends_on
      : Object.keys((service.depends_on ?? {}) as object);
    for (const dependency of dependencies)
      if (typeof dependency === 'string' && model.services[dependency])
        facts.edge(
          `service:${file.path}:${name}`,
          `service:${file.path}:${dependency}`,
          'depends-on',
          facts.ref(file),
          'compose/depends-on',
          'Explicit startup dependency; no runtime communication is implied',
          'extracted-code',
          'explicit',
        );
    const build =
      typeof service.build === 'string'
        ? service.build
        : service.build && typeof service.build === 'object'
          ? (service.build as { context?: unknown }).context
          : undefined;
    const volumes = Array.isArray(service.volumes)
      ? service.volumes.flatMap((volume): string[] => {
          if (typeof volume === 'string') return [volume.split(':')[0]!];
          if (
            volume &&
            typeof volume === 'object' &&
            (volume as { type?: string }).type === 'bind' &&
            typeof (volume as { source?: string }).source === 'string'
          )
            return [(volume as { source: string }).source];
          return [];
        })
      : [];
    for (const [rule, value] of [
      ['build-context', build],
      ...volumes.map((value) => ['bind-mount', value]),
    ] as const) {
      if (typeof value !== 'string' || !value.startsWith('.') || value.includes('$')) continue;
      const path = posix.normalize(posix.join(posix.dirname(file.path), value));
      if (path === '..' || path.startsWith('../')) continue;
      for (const target of facts.nodes.values())
        if (
          target.kind === 'file' &&
          target.sources.some(
            (source) =>
              source.path === path || source.path.startsWith(path === '.' ? '' : path + '/'),
          )
        ) {
          facts.edge(
            `service:${file.path}:${name}`,
            target.id,
            'references',
            facts.ref(file),
            `compose/${rule}`,
            `Explicit local ${rule}; no runtime read, write or communication is implied`,
            'extracted-code',
            'explicit',
          );
        }
    }
  }
}
