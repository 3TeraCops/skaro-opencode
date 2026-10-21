import ts from 'typescript';
import { StaticStrings } from './ts-strings';
import type { TsContext } from './ts-context';

export function functionOf(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let parent = node.parent;
  while (parent) {
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isArrowFunction(parent)) &&
      (parent.name || ts.isVariableDeclaration(parent.parent))
    )
      return parent;
    parent = parent.parent;
  }
  return undefined;
}
export function methodOf(options: ts.Node | undefined, checker: ts.TypeChecker): string {
  if (!options) return 'GET';
  if (!ts.isObjectLiteralExpression(options)) return '*';
  const property = options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText().replaceAll(/["']/g, '') === 'method',
  );
  if (property && ts.isPropertyAssignment(property)) return verb(property.initializer, checker);
  return options.properties.some(ts.isSpreadAssignment) ? '*' : 'GET';
}
export function verb(node: ts.Node | undefined, checker: ts.TypeChecker): string {
  const values = new StaticStrings(checker).evaluate(node);
  const value = values.length === 1 ? values[0]!.toUpperCase() : '*';
  return /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(value) ? value : '*';
}
export function forwardedOptions(
  node: ts.Node | undefined,
  fn: ts.FunctionLikeDeclaration,
): number | undefined {
  if (!node) return undefined;
  const candidates = ts.isObjectLiteralExpression(node)
    ? node.properties.filter(ts.isSpreadAssignment).map((property) => property.expression)
    : [node];
  for (const expression of candidates)
    if (ts.isIdentifier(expression)) {
      const index = fn.parameters.findIndex(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === expression.text,
      );
      if (index >= 0) return index;
    }
  return undefined;
}
export function xhrOpen(node: ts.CallExpression, context: TsContext): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'open' ||
    !ts.isIdentifier(node.expression.expression)
  )
    return false;
  const symbol = context.checker.getSymbolAtLocation(node.expression.expression);
  const declaration = symbol?.valueDeclaration;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isNewExpression(declaration.initializer)
  )
    return false;
  const constructor = declaration.initializer.expression;
  return (
    ts.isIdentifier(constructor) &&
    constructor.text === 'XMLHttpRequest' &&
    !context.symbolId(constructor)
  );
}
