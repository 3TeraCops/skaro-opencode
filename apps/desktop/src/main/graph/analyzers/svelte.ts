import ts from 'typescript';
import { posix } from 'node:path';
import type { Facts } from '../facts';
import type { TsInput } from './typescript-input';

export function svelteReferences(
  entry: TsInput,
  facts: Facts,
  locals: Map<string, string>,
  symbolId: (node: ts.Node) => string | undefined,
): void {
  const imports = new Map<string, string>();
  for (const node of entry.source.statements)
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.name
    ) {
      const name = node.importClause.name.text;
      const path = node.moduleSpecifier.text;
      const direct = path.startsWith('.')
        ? `file:${posix.normalize(posix.join(posix.dirname(entry.file.path), path))}`
        : undefined;
      const target =
        symbolId(node.moduleSpecifier) ?? (direct && facts.nodes.has(direct) ? direct : undefined);
      if (target) imports.set(name, target);
    }
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    const ref = facts.ref(
      entry.file,
      typeof node.start === 'number' ? node.start : undefined,
      typeof node.end === 'number' ? node.end : undefined,
    );
    if (node.type === 'InlineComponent' && typeof node.name === 'string') {
      const target = imports.get(node.name);
      if (target)
        facts.edge(
          `file:${entry.file.path}`,
          target,
          'references',
          ref,
          'svelte/component',
          'Imported component occurs in the compiled Svelte template',
        );
    }
    if (node.type === 'EventHandler' && typeof node.name === 'string') {
      const expression = node.expression as { type?: string; name?: string } | undefined;
      const target = expression?.type === 'Identifier' ? locals.get(expression.name!) : undefined;
      if (target)
        facts.edge(
          `file:${entry.file.path}`,
          target,
          'handles',
          ref,
          'svelte/handler',
          `Explicit handler binding for ${node.name}`,
        );
    }
    if (
      node.type === 'Attribute' &&
      typeof node.name === 'string' &&
      node.name.startsWith('on') &&
      Array.isArray(node.value)
    ) {
      for (const value of node.value as { expression?: { type?: string; name?: string } }[]) {
        const target =
          value.expression?.type === 'Identifier' ? locals.get(value.expression.name!) : undefined;
        if (target)
          facts.edge(
            `file:${entry.file.path}`,
            target,
            'handles',
            ref,
            'svelte/handler',
            `Explicit handler binding for ${node.name}`,
          );
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(entry.template);
}
