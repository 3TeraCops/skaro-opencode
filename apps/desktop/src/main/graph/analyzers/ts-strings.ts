import ts from 'typescript';

type Environment = Map<string, string[]>;
/** Bounded symbolic string evaluation. It never executes project functions or config plugins. */
export class StaticStrings {
  private readonly checker: ts.TypeChecker;
  private visits = 0;
  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }
  evaluate(node: ts.Node | undefined, env: Environment = new Map(), depth = 0): string[] {
    if (!node || depth > 10 || ++this.visits > 4000) return ['{dynamic}'];
    const next = (value: ts.Node | undefined) => this.evaluate(value, env, depth + 1);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.text];
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return next(node.expression);
    if (ts.isIdentifier(node)) {
      const bound = env.get(node.text);
      if (bound) return bound;
      const declaration = this.declaration(node);
      if (declaration && ts.isVariableDeclaration(declaration))
        return next(declaration.initializer);
      return ['{dynamic}'];
    }
    if (ts.isTemplateExpression(node)) {
      let result = [node.head.text];
      for (const span of node.templateSpans)
        result = this.combine(result, next(span.expression)).map(
          (text) => text + span.literal.text,
        );
      return result;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return this.combine(next(node.left), next(node.right));
    if (ts.isConditionalExpression(node))
      return [...new Set([...next(node.whenTrue), ...next(node.whenFalse)])].slice(0, 8);
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'slice') {
        const argument = node.arguments[0];
        let start = argument && ts.isNumericLiteral(argument) ? Number(argument.text) : undefined;
        if (
          argument &&
          ts.isPropertyAccessExpression(argument) &&
          argument.name.text === 'length' &&
          ts.isStringLiteralLike(argument.expression)
        )
          start = argument.expression.text.length;
        if (start !== undefined)
          return next(node.expression.expression).map((value) =>
            value === '{dynamic}' ? value : value.slice(start),
          );
      }
      const declaration = this.declaration(node.expression);
      const fn =
        declaration && ts.isVariableDeclaration(declaration)
          ? declaration.initializer
          : declaration;
      if (
        fn &&
        (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))
      )
        return this.function(fn, node.arguments.map(next), depth + 1);
    }
    return ['{dynamic}'];
  }
  declaration(node: ts.Node): ts.Declaration | undefined {
    let symbol = this.checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = this.checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
  environment(fn: ts.FunctionLikeDeclaration, args: string[][], depth = 0): Environment {
    const env: Environment = new Map();
    fn.parameters.forEach((parameter, index) => {
      if (ts.isIdentifier(parameter.name))
        env.set(parameter.name.text, args[index] ?? ['{dynamic}']);
    });
    if (fn.body && ts.isBlock(fn.body))
      for (const statement of fn.body.statements) {
        if (ts.isVariableStatement(statement))
          for (const declaration of statement.declarationList.declarations)
            if (ts.isIdentifier(declaration.name))
              env.set(
                declaration.name.text,
                this.evaluate(declaration.initializer, env, depth + 1),
              );
        if (
          ts.isExpressionStatement(statement) &&
          ts.isBinaryExpression(statement.expression) &&
          statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(statement.expression.left)
        )
          env.set(
            statement.expression.left.text,
            this.evaluate(statement.expression.right, env, depth + 1),
          );
      }
    return env;
  }
  private function(fn: ts.FunctionLikeDeclaration, args: string[][], depth: number): string[] {
    if (depth > 10 || !fn.body) return ['{dynamic}'];
    const env = this.environment(fn, args, depth),
      result: string[] = [];
    if (!ts.isBlock(fn.body)) return this.evaluate(fn.body, env, depth + 1);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && node !== fn) return;
      if (ts.isReturnStatement(node)) {
        result.push(...this.evaluate(node.expression, env, depth + 1));
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    return [...new Set(result)].slice(0, 8);
  }
  private combine(left: string[], right: string[]): string[] {
    return left.flatMap((a) => right.map((b) => a + b)).slice(0, 8);
  }
}
