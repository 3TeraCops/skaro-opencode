import type { Facts } from '../facts';
import type { PyDeclaration, PyDocument } from './python-model';

export class PythonResolver {
  private readonly modules = new Map<string, PyDocument[]>();
  private readonly declarations = new Map<string, PyDeclaration>();
  readonly documents: PyDocument[];
  constructor(documents: PyDocument[]) {
    this.documents = documents;
    for (const document of documents) {
      const parts = document.module.split('.');
      for (let index = 0; index < parts.length; index++) {
        const suffix = parts.slice(index).join('.');
        const previous = this.modules.get(suffix) ?? [];
        previous.push(document);
        this.modules.set(suffix, previous);
      }
      document.declarations.forEach((declaration) =>
        this.declarations.set(declaration.id, declaration),
      );
    }
  }
  module(name: string, document: PyDocument): PyDocument | undefined {
    if (name.startsWith('.')) {
      const dots = /^\.+/.exec(name)![0].length;
      const parts = document.module.split('.');
      if (!document.file.path.endsWith('/__init__.py')) parts.pop();
      name = [...parts.slice(0, Math.max(0, parts.length - dots + 1)), name.slice(dots)]
        .filter(Boolean)
        .join('.');
    }
    const matches = this.modules.get(name) ?? [];
    if (matches.length === 1) return matches[0];
    // Never choose between identically named modules from different source roots by coincidence.
    const ownRoot = document.file.path.slice(
      0,
      document.file.path.length - document.module.replaceAll('.', '/').length - 3,
    );
    const own = matches.filter((candidate) => candidate.file.path.startsWith(ownRoot));
    return own.length === 1 ? own[0] : undefined;
  }
  declaration(id: string): PyDeclaration | undefined {
    return this.declarations.get(id);
  }
  resolve(
    name: string,
    document: PyDocument,
    scope: string[] = [],
    seen = new Set<string>(),
  ): string | undefined {
    const key = `${document.file.path}:${scope.join('.')}:${name}`;
    if (seen.has(key) || seen.size > 40) return undefined;
    seen.add(key);
    if (!/^[\p{L}\p{N}_.]+$/u.test(name)) return undefined;
    if (name.startsWith('self.') || name.startsWith('cls.')) {
      const parent = document.declarations
        .filter(
          (declaration) =>
            declaration.kind === 'class' &&
            (scope.join('.') === declaration.qualified ||
              scope.join('.').startsWith(declaration.qualified + '.')),
        )
        .sort((a, b) => b.qualified.length - a.qualified.length)[0];
      return parent
        ? document.declarations.find(
            (declaration) =>
              declaration.qualified === `${parent.qualified}.${name.split('.').slice(1).join('.')}`,
          )?.id
        : undefined;
    }
    for (let depth = scope.length; depth >= 0; depth--) {
      const prefix = scope.slice(0, depth);
      if (
        depth < scope.length &&
        document.declarations.some(
          (item) => item.kind === 'class' && item.qualified === prefix.join('.'),
        )
      )
        continue;
      const qualified = [...prefix, name].join('.');
      const declaration = document.declarations.filter((item) => item.qualified === qualified);
      if (declaration.length === 1) return declaration[0]!.id;
      const head = name.split('.')[0]!;
      if (
        document.bindings.some(
          (binding) => binding.name === head && binding.scope.join('.') === prefix.join('.'),
        )
      ) {
        const calls = document.calls.filter(
          (call) => call.assigned === head && call.scope.join('.') === prefix.join('.'),
        );
        const assignment = calls.length === 1 ? calls[0] : undefined;
        if (assignment && name.includes('.')) {
          const target = this.resolve(assignment.expression, document, prefix, seen),
            type = target ? this.declaration(target) : undefined;
          if (type?.kind === 'class') {
            const candidates = [...this.declarations.values()].filter(
              (item) =>
                item.ref.path === type.ref.path &&
                item.qualified === `${type.qualified}.${name.split('.').slice(1).join('.')}`,
            );
            return candidates.length === 1 ? candidates[0]!.id : undefined;
          }
        }
        return undefined;
      }
      const bindings = document.imports.filter(
        (binding) => binding.local === head && binding.scope.join('.') === prefix.join('.'),
      );
      if (bindings.length === 1) {
        const binding = bindings[0]!,
          module = this.module(binding.module, document);
        const tail = name.split('.').slice(1).join('.');
        if (module) {
          const member = [binding.imported, tail].filter(Boolean).join('.');
          if (!member) return `file:${module.file.path}`;
          const target = this.resolve(member, module, [], seen);
          if (target) return target;
        }
        if (binding.imported) {
          const child = this.module(`${binding.module}.${binding.imported}`, document);
          if (child) return tail ? this.resolve(tail, child, [], seen) : `file:${child.file.path}`;
        }
      }
    }
    return undefined;
  }
  connect(facts: Facts): void {
    for (const document of this.documents) {
      for (const declaration of document.declarations) {
        const owner =
          document.declarations.find((item) => item.qualified === declaration.scope.join('.'))
            ?.id ?? `file:${document.file.path}`;
        facts.edge(
          owner,
          declaration.id,
          'contains',
          declaration.ref,
          'python/declaration',
          'Lexically scoped Python declaration',
          'extracted-code',
          'explicit',
        );
        for (const base of declaration.bases) {
          const target = this.resolve(base, document, declaration.scope);
          if (target)
            facts.edge(
              declaration.id,
              target,
              'inherits',
              declaration.ref,
              'python/inherits',
              'Base class resolved through lexical imports',
            );
          else
            facts.missing(
              declaration.id,
              base,
              'inherits',
              declaration.ref,
              'External or dynamic base class',
            );
        }
      }
      for (const binding of document.imports) {
        const module = this.module(binding.module, document);
        const target = binding.imported
          ? this.resolve(binding.local, document, binding.scope)
          : module && `file:${module.file.path}`;
        if (target)
          facts.edge(
            `file:${document.file.path}`,
            target,
            'imports',
            binding.ref,
            'python/import',
            'Static Python import resolved to one local module/declaration',
            'extracted-code',
            'explicit',
          );
        else
          facts.missing(
            `file:${document.file.path}`,
            `${binding.module}${binding.imported ? `.${binding.imported}` : ''}`,
            'imports',
            binding.ref,
            'Import is external, ambiguous, or dynamic',
          );
      }
      for (const call of document.calls) {
        const target = this.resolve(call.expression, document, call.scope);
        if (target)
          facts.edge(
            call.owner,
            target,
            'calls',
            call.ref,
            'python/call',
            'Call resolved through local scope and explicit imports',
          );
        else
          facts.missing(
            call.owner,
            call.expression,
            'calls',
            call.ref,
            'Unknown receiver or external/dynamic call',
          );
      }
      for (const reference of document.references) {
        const target = this.resolve(reference.name, document, reference.scope);
        if (target && target !== reference.owner)
          facts.edge(
            reference.owner,
            target,
            'references',
            reference.ref,
            'python/reference',
            'Reference resolved through lexical declarations and imports',
          );
      }
    }
  }
}
