import ts from 'typescript';
import type { Facts, SourceFile } from '../facts';
import { inputs, programs } from './typescript-input';
import { svelteReferences } from './svelte';
import { analyzeHttp } from './http';
import { analyzeRegistries } from './ts-registries';
import type { HttpRoute } from './django';
import type { TsContext } from './ts-context';

function declared(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isParameter(node)
  );
}
export function analyzeTypescript(
  root: string,
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
  routes: HttpRoute[] = [],
): void {
  const entries = inputs(root, files, diagnostic);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const ids = new Map<string, string>(),
    names = new Map<string, Map<string, string>>();
  const declarationKey = (node: ts.Node) =>
    `${node.getSourceFile().fileName}:${node.pos}:${node.kind}`;
  const owners = new Map<string, string>();
  for (const entry of entries) {
    const counts = new Map<string, number>(),
      local = new Map<string, string>();
    names.set(entry.file.path, local);
    const visit = (node: ts.Node, scope: string[], owner: string): void => {
      let nextOwner = owner,
        nextScope = scope;
      if (declared(node) && node.name && !ts.isParameter(node)) {
        const name = node.name.getText(entry.source);
        const qualified = [...scope, name].join('.');
        const key = `${qualified}:${ts.SyntaxKind[node.kind]}`;
        const ordinal = counts.get(key) ?? 0;
        counts.set(key, ordinal + 1);
        const id = `symbol:ts:${entry.file.path}:${key}:${ordinal}`;
        ids.set(declarationKey(node), id);
        if (!scope.length) local.set(name, id);
        facts.node({
          id,
          kind: 'symbol',
          name,
          qualifiedName: `${entry.file.path}#${qualified}`,
          origin: 'extracted-code',
          sources: [facts.ref(entry.file, node.getStart(entry.source), node.end)],
          attributes: {
            language: entry.file.language,
            symbolKind: ts.SyntaxKind[node.kind],
            scope: scope.join('.'),
          },
        });
        facts.edge(
          owner,
          id,
          'contains',
          facts.ref(entry.file, node.getStart(entry.source), node.end),
          'ts/declaration',
          'Lexical declaration',
          'extracted-code',
          'explicit',
        );
        if (
          !ts.isVariableDeclaration(node) ||
          (node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
        ) {
          nextOwner = id;
          nextScope = [...scope, name];
        }
      }
      owners.set(`${entry.name}:${node.pos}:${node.kind}`, nextOwner);
      ts.forEachChild(node, (child) => visit(child, nextScope, nextOwner));
    };
    visit(entry.source, [], `file:${entry.file.path}`);
  }
  const done = new Set<string>();
  const contexts: TsContext[] = [];
  for (const program of programs(root, files, entries)) {
    const checker = program.getTypeChecker();
    const symbolId = (node: ts.Node): string | undefined => {
      let symbol = checker.getSymbolAtLocation(node);
      if (!symbol) return undefined;
      const visited = new Set<ts.Symbol>();
      while (symbol.flags & ts.SymbolFlags.Alias && !visited.has(symbol)) {
        visited.add(symbol);
        const target = checker.getAliasedSymbol(symbol);
        if (target === symbol) break;
        symbol = target;
      }
      const targets = new Set<string>(),
        implementations = new Set<string>();
      for (const declaration of symbol.declarations ?? []) {
        const id = ids.get(declarationKey(declaration));
        if (id) {
          targets.add(id);
          if (
            (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
            declaration.body
          )
            implementations.add(id);
        }
        const input = byName.get(declaration.getSourceFile().fileName);
        if (input && ts.isSourceFile(declaration)) targets.add(`file:${input.file.path}`);
      }
      if (implementations.size === 1 && targets.size > 1) {
        const implementation = [...implementations][0]!,
          family = implementation.slice(0, implementation.lastIndexOf(':'));
        if ([...targets].every((target) => target.slice(0, target.lastIndexOf(':')) === family))
          return implementation;
      }
      return targets.size === 1 ? [...targets][0] : undefined;
    };
    for (const source of program.getSourceFiles()) {
      const entry = byName.get(source.fileName);
      if (!entry || done.has(source.fileName)) continue;
      done.add(source.fileName);
      for (const issue of program.getSyntacticDiagnostics(source))
        diagnostic(entry.file.path, ts.flattenDiagnosticMessageText(issue.messageText, '\n'));
      const visit = (node: ts.Node, owner: string): void => {
        owner = owners.get(`${entry.name}:${node.pos}:${node.kind}`) ?? owner;
        const ref = () => facts.ref(entry.file, node.getStart(source), node.end);
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const target = symbolId(node.moduleSpecifier);
          const kind = ts.isImportDeclaration(node) ? 'imports' : 'exports';
          if (target)
            facts.edge(
              `file:${entry.file.path}`,
              target,
              kind,
              ref(),
              'ts/module',
              'Static module reference resolved by TypeScript',
              'extracted-code',
              'explicit',
            );
          else
            facts.missing(
              `file:${entry.file.path}`,
              node.moduleSpecifier.text,
              kind,
              ref(),
              'Module is external or cannot be resolved within the registered sources',
            );
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const expression = node.expression;
          const target = symbolId(
            ts.isPropertyAccessExpression(expression) ? expression.name : expression,
          );
          if (target)
            facts.edge(
              owner,
              target,
              'calls',
              ref(),
              'ts/call',
              'Call target resolved by TypeScript symbol declarations',
            );
          else
            facts.missing(
              owner,
              expression.getText(source),
              'calls',
              ref(),
              'Dynamic or external call target',
            );
        }
        if (ts.isHeritageClause(node))
          for (const type of node.types) {
            const target = symbolId(type.expression);
            if (target)
              facts.edge(
                owner,
                target,
                node.token === ts.SyntaxKind.ExtendsKeyword ? 'inherits' : 'implements',
                ref(),
                'ts/heritage',
                'Resolved heritage declaration',
              );
            else
              facts.missing(
                owner,
                type.expression.getText(source),
                'inherits',
                ref(),
                'External or unresolved base type',
              );
          }
        if (
          ts.isIdentifier(node) &&
          !declared(node.parent) &&
          !ts.isImportSpecifier(node.parent) &&
          !ts.isImportClause(node.parent) &&
          !ts.isExportSpecifier(node.parent)
        ) {
          const target = symbolId(node);
          if (target && target !== owner && !target.startsWith('file:'))
            facts.edge(
              owner,
              target,
              'references',
              ref(),
              'ts/reference',
              'Symbol reference resolved within its lexical/type scope',
            );
        }
        ts.forEachChild(node, (child) => visit(child, owner));
      };
      visit(source, `file:${entry.file.path}`);
      contexts.push({
        source,
        file: entry.file,
        checker,
        symbolId,
        owner: (node) =>
          owners.get(`${entry.name}:${node.pos}:${node.kind}`) ?? `file:${entry.file.path}`,
        ref: (node) => facts.ref(entry.file, node.getStart(source), node.end),
      });
      if (entry.template) svelteReferences(entry, facts, names.get(entry.file.path)!, symbolId);
    }
  }
  analyzeHttp(contexts, routes, facts);
  analyzeRegistries(contexts, facts);
}
