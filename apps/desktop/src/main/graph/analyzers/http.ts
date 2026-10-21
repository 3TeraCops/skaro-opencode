import ts from 'typescript';
import type { Facts } from '../facts';
import type { TsContext } from './ts-context';
import type { HttpRoute } from './django';
import { StaticStrings } from './ts-strings';
import { functionOf, methodOf, verb, forwardedOptions, xhrOpen } from './http-transport';
export function analyzeHttp(contexts: TsContext[], routes: HttpRoute[], facts: Facts): void {
  const calls: { node: ts.CallExpression; context: TsContext }[] = [];
  const transports = new Map<
    string,
    {
      node: ts.Node;
      fn: ts.FunctionLikeDeclaration;
      context: TsContext;
      method: string;
      options?: number | undefined;
    }[]
  >();
  for (const context of contexts) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        calls.push({ node, context });
        const direct =
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'fetch' &&
          !context.symbolId(node.expression);
        const xhr = xhrOpen(node, context);
        const url = node.arguments[xhr ? 1 : 0];
        if ((direct || xhr) && url) {
          const fn = functionOf(node),
            owner = context.owner(node);
          if (fn && !owner.startsWith('file:')) {
            const list = transports.get(owner) ?? [];
            const options = xhr ? undefined : forwardedOptions(node.arguments[1], fn);
            list.push({
              node: url,
              fn,
              context,
              method: xhr
                ? verb(node.arguments[0], context.checker)
                : methodOf(node.arguments[1], context.checker),
              options,
            });
            transports.set(owner, list);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.source);
  }
  for (const { node, context } of calls) {
    const target = context.symbolId(
      ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression,
    );
    const wrapper = target ? transports.get(target) : undefined;
    const direct = ts.isIdentifier(node.expression) && node.expression.text === 'fetch' && !target;
    if ((!wrapper && !direct) || !node.arguments[0]) continue;
    let requests: { path: string; method: string }[];
    if (wrapper)
      requests = wrapper.flatMap((transport) => {
        const evaluator = new StaticStrings(context.checker);
        const args = node.arguments.map((argument) => evaluator.evaluate(argument));
        const template = new StaticStrings(transport.context.checker);
        const method =
          transport.options === undefined
            ? transport.method
            : methodOf(node.arguments[transport.options], context.checker);
        return template
          .evaluate(transport.node, template.environment(transport.fn, args))
          .map((path) => ({ path, method }));
      });
    else
      requests = new StaticStrings(context.checker)
        .evaluate(node.arguments[0])
        .map((path) => ({ path, method: methodOf(node.arguments[1], context.checker) }));
    for (const { path: raw, method } of requests) {
      const path = raw.split(/[?#]/)[0]!;
      if (!path.startsWith('/') || path.startsWith('//') || path.length > 400 || path.includes('@'))
        continue;
      const id = `request:${context.owner(node)}:${method}:${path}`;
      facts.node({
        id,
        kind: 'endpoint',
        name: `${method} ${path}`,
        origin: 'extracted-code',
        sources: [context.ref(node)],
        attributes: {
          language: context.file.language,
          request: true,
          path,
          method,
          client: wrapper ? 'resolved wrapper' : 'fetch',
        },
      });
      facts.edge(
        context.owner(node),
        id,
        'requests',
        context.ref(node),
        'http/client',
        'Static request expression; no request is executed',
        'extracted-code',
        wrapper || path.includes('{dynamic}') || method === '*' ? 'inferred' : 'explicit',
      );
      const normalized = path.replaceAll(/\{dynamic\}|<[^>]+>/g, '{}').replace(/\/$/, '');
      for (const route of routes)
        if (
          (route.method === '*' || method === '*' || route.method === method) &&
          route.path.replaceAll(/<[^>]+>/g, '{}').replace(/\/$/, '') === normalized
        )
          facts.edge(
            id,
            route.id,
            'requests',
            context.ref(node),
            'http/urlconf-candidate',
            'Client path candidate matches a static URLConf route; runtime base URL, branch conditions, permissions and delivery remain unverified',
            'analyzer-inferred',
            'inferred',
          );
    }
  }
}
