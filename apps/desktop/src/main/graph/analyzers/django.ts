import type { Facts } from '../facts';
import type { PyDocument, PyCall } from './python-model';
import type { PythonResolver } from './python-resolve';

export interface HttpRoute {
  id: string;
  path: string;
  method: string;
  context: string;
}
export function importedPythonName(document: PyDocument, expression: string): string {
  const [head, ...tail] = expression.split('.');
  const binding = document.imports.find((item) => item.local === head && !item.scope.length);
  return binding
    ? [binding.module, binding.imported, ...tail].filter(Boolean).join('.')
    : expression;
}
export function analyzeDjango(resolver: PythonResolver, facts: Facts): HttpRoute[] {
  const routes: HttpRoute[] = [];
  const tables = new Map<
    PyDocument,
    { call: PyCall; path: string; child?: PyDocument; target?: string }[]
  >();
  const children = new Set<PyDocument>();
  for (const document of resolver.documents) {
    for (const declaration of document.declarations.filter((item) => item.kind === 'class')) {
      if (
        declaration.bases.some(
          (base) => importedPythonName(document, base) === 'django.db.models.Model',
        )
      ) {
        facts.nodes.get(declaration.id)!.kind = 'model';
        facts.nodes.get(declaration.id)!.attributes.framework = 'django';
      }
    }
    const local = tables.get(document) ?? [];
    tables.set(document, local);
    for (const call of document.calls) {
      const name = importedPythonName(document, call.expression);
      if (name === 'django.urls.path' || name === 'django.urls.re_path') {
        const path = call.args[0]?.literal;
        if (path === undefined) continue;
        const included = document.calls.find(
          (candidate) =>
            candidate.ref.start! > call.ref.start! &&
            candidate.ref.end! <= call.ref.end! &&
            importedPythonName(document, candidate.expression) === 'django.urls.include',
        );
        const child = included?.args[0]?.literal
          ? resolver.module(included.args[0].literal, document)
          : undefined;
        if (child) children.add(child);
        const expression = call.args[1]?.expression.replace(/\.as_view\([\s\S]*$/, '');
        const target =
          !included && expression ? resolver.resolve(expression, document, call.scope) : undefined;
        local.push({ call, path, ...(child ? { child } : {}), ...(target ? { target } : {}) });
      }
      const relation = /\.(ForeignKey|OneToOneField|ManyToManyField)$/.test(name);
      if (relation) {
        const owner = document.declarations.find(
          (declaration) => declaration.qualified === call.scope.join('.'),
        );
        const expression = call.args[0]?.literal ?? call.args[0]?.expression;
        const target =
          expression === 'self'
            ? owner?.id
            : expression
              ? resolver.resolve(expression, document, call.scope.slice(0, -1))
              : undefined;
        if (owner && target && facts.nodes.get(owner.id)?.kind === 'model')
          facts.edge(
            owner.id,
            target,
            'model-relation',
            call.ref,
            'django/model-relation',
            `Explicit ORM field ${call.expression}; no physical table mapping is assumed`,
          );
      }
    }
  }
  // Query semantics are recorded only when the manager receiver resolves to a concrete local model.
  for (const document of resolver.documents)
    for (const call of document.calls) {
      const match =
        /^([\w.]+)\.objects\.(get|filter|all|exclude|values|values_list|count|exists|first|last|create|bulk_create|update|delete|update_or_create|get_or_create)\b/.exec(
          call.expression,
        );
      if (match) {
        const target = resolver.resolve(match[1]!, document, call.scope);
        if (target && facts.nodes.get(target)?.kind === 'model') {
          const kind = /create|update|delete/.test(match[2]!) ? 'writes' : 'reads';
          facts.edge(
            call.owner,
            target,
            kind,
            call.ref,
            'django/manager',
            `Statically resolved ${call.expression}; this is source behavior, not observed database activity`,
          );
        }
      }
    }
  const walk = (
    document: PyDocument,
    prefix: string,
    context: string,
    seen: Set<PyDocument>,
  ): void => {
    if (seen.has(document) || seen.size > 24) return;
    const nextSeen = new Set(seen).add(document);
    for (const route of tables.get(document) ?? []) {
      const path = '/' + `${prefix}/${route.path}`.replaceAll(/\/+/g, '/').replace(/^\//, '');
      if (route.child) {
        walk(route.child, path, context, nextSeen);
        continue;
      }
      if (!route.target) {
        facts.missing(
          `file:${document.file.path}`,
          path,
          'handles',
          route.call.ref,
          'URLConf handler/include is dynamic or unresolved',
        );
        continue;
      }
      const declaration = resolver.declaration(route.target);
      const methods =
        declaration?.kind === 'class' ? documentMethods(resolver, declaration.id) : [];
      for (const method of methods.length ? methods : [{ name: '*', id: route.target }]) {
        const id = `endpoint:django:${context}:${method.name}:${path}`;
        facts.node({
          id,
          kind: 'endpoint',
          name: `${method.name.toUpperCase()} ${path}`,
          origin: 'extracted-code',
          sources: [route.call.ref],
          attributes: {
            language: 'python',
            framework: 'django',
            path,
            method: method.name.toUpperCase(),
            context,
          },
        });
        facts.edge(
          id,
          method.id,
          'handles',
          route.call.ref,
          'django/urlconf',
          'Explicit URLConf handler including resolved include prefixes',
          'extracted-code',
          'explicit',
        );
        facts.edge(
          `file:${document.file.path}`,
          id,
          'contains',
          route.call.ref,
          'django/urlconf',
          'Route declared in this URLConf',
          'extracted-code',
          'explicit',
        );
        routes.push({ id, path, method: method.name.toUpperCase(), context });
      }
    }
  };
  for (const document of resolver.documents)
    if (tables.get(document)?.length && !children.has(document))
      walk(document, '', document.file.path, new Set());
  return routes;
}
function documentMethods(resolver: PythonResolver, id: string): { name: string; id: string }[] {
  const declaration = resolver.declaration(id);
  if (!declaration) return [];
  const document = resolver.documents.find((item) => item.file.path === declaration.ref.path);
  return (
    document?.declarations
      .filter(
        (item) =>
          item.scope.join('.') === declaration.qualified &&
          /^(get|post|put|patch|delete|head|options)$/.test(item.name),
      )
      .map((item) => ({ name: item.name, id: item.id })) ?? []
  );
}
