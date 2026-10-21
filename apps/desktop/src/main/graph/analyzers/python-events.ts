import type { Facts } from '../facts';
import type { PythonResolver } from './python-resolve';
import type { PyDocument, PyCall } from './python-model';

export function analyzePythonEvents(resolver: PythonResolver, facts: Facts): void {
  const literal = (
    document: PyDocument,
    argument: PyCall['args'][number] | undefined,
    scope: string[],
  ): string | undefined => {
    if (!argument) return undefined;
    if (argument.literal) return argument.literal;
    const target = resolver.resolve(argument.expression, document, scope);
    return target ? resolver.declaration(target)?.value : undefined;
  };
  const event = (namespace: string, name: string, call: PyCall): string => {
    const id = `event:python:${namespace}:${name}`;
    if (!facts.nodes.has(id))
      facts.node({
        id,
        kind: 'event',
        name,
        origin: 'analyzer-inferred',
        sources: [call.ref],
        attributes: { language: 'python', namespace, pattern: 'static registry/outbox' },
      });
    return id;
  };
  for (const document of resolver.documents)
    for (const call of document.calls) {
      const target = resolver.resolve(call.expression, document, call.scope);
      const declaration = target ? resolver.declaration(target) : undefined;
      const definition =
        declaration && resolver.documents.find((item) => item.file.path === declaration.ref.path);
      if (!declaration || !definition) continue;
      const body = definition.file.text.slice(declaration.ref.start, declaration.ref.end);
      const namespace = definition.module.split('.').slice(0, -1).join('.');
      if (call.handler && /\b\w+\[\w+\]\s*=\s*handler\b/.test(body)) {
        const name = literal(document, call.args[0], call.scope);
        const handler = resolver.resolve(call.handler, document, call.scope);
        if (name && handler)
          facts.edge(
            event(namespace, name, call),
            handler,
            'consumes',
            call.ref,
            'python/registry',
            'Decorator registers this handler under a statically resolved event name; delivery is not asserted',
            'analyzer-inferred',
            'inferred',
          );
      }
      const type = call.args.find((argument) => argument.keyword === 'event_type');
      if (type && declaration.kind === 'class' && /\bevent_type\s*:\s*str\b/.test(body)) {
        const outer = document.calls.find(
          (candidate) =>
            candidate !== call &&
            candidate.ref.start! < call.ref.start! &&
            candidate.ref.end! >= call.ref.end!,
        );
        if (!outer) continue;
        const queuedId = resolver.resolve(outer.expression, document, outer.scope),
          queued = queuedId && resolver.declaration(queuedId);
        const queueFile =
          queued && resolver.documents.find((item) => item.file.path === queued.ref.path);
        const queueBody =
          queueFile && queued ? queueFile.file.text.slice(queued.ref.start, queued.ref.end) : '';
        const name = literal(document, type, call.scope);
        if (
          name &&
          /\.objects\.create\(/.test(queueBody) &&
          /\bevent_type\s*=\s*\w+\.event_type/.test(queueBody)
        )
          facts.edge(
            call.owner,
            event(namespace, name, call),
            'emits',
            call.ref,
            'python/outbox',
            'Static domain event is passed to a resolved outbox persistence function; dispatch/delivery are separate',
            'analyzer-inferred',
            'inferred',
          );
      }
    }
}
