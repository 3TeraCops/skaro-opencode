import ts from 'typescript';
import type { Facts } from '../facts';
import type { TsContext } from './ts-context';

export function analyzeRegistries(contexts: TsContext[], facts: Facts): void {
  const methods = new Set<string>();
  for (const context of contexts) {
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && /Methods$/.test(node.name.text))
        for (const member of node.members)
          if (member.name && ts.isStringLiteralLike(member.name)) methods.add(member.name.text);
      ts.forEachChild(node, visit);
    };
    visit(context.source);
  }
  for (const context of contexts) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'invoke' &&
        /(?:^|\.)skaro$/.test(node.expression.expression.getText(context.source)) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        methods.has(node.arguments[0].text)
      ) {
        const name = node.arguments[0].text,
          id = `event:ipc:${name}`;
        if (!facts.nodes.has(id))
          facts.node({
            id,
            kind: 'event',
            name,
            origin: 'extracted-code',
            sources: [context.ref(node)],
            attributes: { transport: 'Electron IPC', language: 'typescript' },
          });
        facts.edge(
          context.owner(node),
          id,
          'emits',
          context.ref(node),
          'electron/invoke',
          'Explicit typed preload method invocation',
          'extracted-code',
          'explicit',
        );
      }
      if (
        ts.isPropertyAssignment(node) &&
        ts.isStringLiteralLike(node.name) &&
        methods.has(node.name.text)
      ) {
        const fn = functionParent(node);
        if (fn?.type?.getText(context.source).includes('Handlers')) {
          const name = node.name.text,
            id = `event:ipc:${name}`;
          if (!facts.nodes.has(id))
            facts.node({
              id,
              kind: 'event',
              name,
              origin: 'extracted-code',
              sources: [context.ref(node)],
              attributes: { transport: 'Electron IPC', language: 'typescript' },
            });
          facts.edge(
            id,
            context.owner(node),
            'handles',
            context.ref(node),
            'electron/handler-map',
            'Explicit entry in the typed main-process handler map',
            'extracted-code',
            'explicit',
          );
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment);
        const name = properties.find(
          (property) => property.name.getText(context.source) === 'name',
        );
        const handler = properties.find(
          (property) => property.name.getText(context.source) === 'call',
        );
        if (
          name &&
          handler &&
          ts.isStringLiteralLike(name.initializer) &&
          properties.some((property) => property.name.getText(context.source) === 'inputSchema')
        ) {
          const id = `endpoint:mcp:${name.initializer.text}`;
          facts.node({
            id,
            kind: 'endpoint',
            name: name.initializer.text,
            origin: 'extracted-code',
            sources: [context.ref(node)],
            attributes: { transport: 'MCP', language: 'typescript' },
          });
          facts.edge(
            id,
            context.owner(handler),
            'handles',
            context.ref(handler),
            'mcp/tool',
            'Explicit MCP tool schema and call handler',
            'extracted-code',
            'explicit',
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.source);
  }
}
function functionParent(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let parent = node.parent;
  while (parent) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent)
    )
      return parent;
    parent = parent.parent;
  }
  return undefined;
}
