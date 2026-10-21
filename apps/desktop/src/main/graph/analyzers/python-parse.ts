import type { Node, Parser } from 'web-tree-sitter';
import type { Facts, SourceFile } from '../facts';
import type { PyDocument, PyCall } from './python-model';
const children = (node: Node | null | undefined): Node[] =>
  node?.namedChildren.filter((child): child is Node => child !== null) ?? [];

export function parsePython(parser: Parser, file: SourceFile, facts: Facts): PyDocument {
  const document: PyDocument = {
    file,
    module: file.path
      .replace(/\.py$/, '')
      .replace(/\/__init__$/, '')
      .replaceAll('/', '.'),
    declarations: [],
    imports: [],
    calls: [],
    references: [],
    bindings: [],
    errors: false,
  };
  const tree = parser.parse(file.text);
  if (!tree) throw new Error('Python parser cancelled');
  document.errors = tree.rootNode.hasError;
  const counts = new Map<string, number>();
  let visited = 0;
  const ref = (node: Node) => facts.ref(file, node.startIndex, node.endIndex);
  const field = (node: Node, name: string) => node.childForFieldName(name);
  function visit(node: Node, scope: string[], owner: string): void {
    if (++visited > 200_000) throw new Error('Python AST node limit exceeded');
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const name = field(node, 'name')!.text,
        kind = node.type === 'class_definition' ? 'class' : 'function';
      const qualified = [...scope, name].join('.'),
        key = `${qualified}:${kind}`;
      const ordinal = counts.get(key) ?? 0;
      counts.set(key, ordinal + 1);
      const id = `symbol:py:${file.path}:${key}:${ordinal}`;
      document.declarations.push({
        id,
        name,
        qualified,
        scope,
        kind,
        ref: ref(node),
        bases: children(field(node, 'superclasses')).map((base) => base.text),
      });
      const body = field(node, 'body');
      for (const parameter of children(field(node, 'parameters'))) {
        const name =
          parameter.type === 'identifier'
            ? parameter
            : (field(parameter, 'name') ??
              children(parameter).find((child) => child.type === 'identifier'));
        if (name)
          document.bindings.push({
            name: name.text,
            scope: [...scope, document.declarations.at(-1)!.name],
          });
      }
      if (body) visit(body, [...scope, name], id);
      // Defaults/decorators execute in the enclosing scope, not inside the function body.
      for (const child of children(node))
        if (child.id !== body?.id && child.type !== 'identifier' && child.type !== 'parameters')
          visit(child, scope, owner);
      return;
    }
    if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      const moduleNode = field(node, 'module_name');
      const module = moduleNode?.text ?? '';
      for (const child of children(node)) {
        if (moduleNode && child.startIndex === moduleNode.startIndex) continue;
        const imported = child.type === 'aliased_import' ? field(child, 'name')?.text : child.text;
        if (!imported || imported === '*') continue;
        const alias = child.type === 'aliased_import' ? field(child, 'alias')?.text : undefined;
        document.imports.push({
          local: alias ?? (module ? imported : imported.split('.')[0]!),
          module: module || imported,
          ...(module ? { imported } : {}),
          scope,
          ref: ref(child),
        });
      }
      return;
    }
    if (node.type === 'call') {
      const expression = field(node, 'function')?.text ?? '';
      const safeLiteral =
        /(?:^|\.)(?:path|re_path|include|register|subscribe|publish|emit|enqueue|enqueue_event|DomainEvent|enqueue_domain_event|ForeignKey|OneToOneField|ManyToManyField|request|get|post|put|patch|delete)$/.test(
          expression,
        );
      const args: PyCall['args'] = children(field(node, 'arguments')).map((argument) => {
        const value = argument.type === 'keyword_argument' ? field(argument, 'value')! : argument;
        const keyword =
          argument.type === 'keyword_argument' ? field(argument, 'name')?.text : undefined;
        const literal =
          safeLiteral && value.type === 'string'
            ? (children(value).find((child) => child.type === 'string_content')?.text ?? '')
            : undefined;
        return {
          expression: value.type === 'string' ? '<string>' : value.text.slice(0, 240),
          ...(literal !== undefined &&
          literal.length < 180 &&
          /^[\p{L}\p{N}./_<>:^$?*+{}()[\]\\|=-]*$/u.test(literal)
            ? { literal }
            : {}),
          ...(keyword ? { keyword } : {}),
        };
      });
      const assignment =
        node.parent?.type === 'assignment' ? field(node.parent, 'left') : undefined;
      let decorated = node.parent;
      while (
        decorated &&
        decorated.type !== 'decorated_definition' &&
        decorated.type !== 'module' &&
        decorated.type !== 'block'
      )
        decorated = decorated.parent;
      const handler =
        decorated?.type === 'decorated_definition'
          ? field(decorated, 'definition')?.childForFieldName('name')?.text
          : undefined;
      document.calls.push({
        expression,
        owner,
        scope,
        ref: ref(node),
        args,
        ...(assignment?.type === 'identifier' ? { assigned: assignment.text } : {}),
        ...(handler ? { handler: [...scope, handler].join('.') } : {}),
      });
    }
    if (node.type === 'assignment') {
      const left = field(node, 'left'),
        right = field(node, 'right');
      if (left?.type === 'identifier') document.bindings.push({ name: left.text, scope });
      if (
        left?.type === 'identifier' &&
        right?.type === 'string' &&
        /(?:EVENT|REQUEST|READY|CHANGED|CREATED|UPDATED|COMPLETED|DUE|TYPE)/.test(left.text)
      ) {
        const value = children(right).find((child) => child.type === 'string_content')?.text;
        if (value && /^[\p{L}\p{N}_.:-]{1,120}$/u.test(value))
          document.declarations.push({
            id: `symbol:py:${file.path}:${[...scope, left.text].join('.')}:constant:0`,
            name: left.text,
            qualified: [...scope, left.text].join('.'),
            scope,
            kind: 'constant',
            value,
            ref: ref(node),
            bases: [],
          });
      }
    }
    if (node.type === 'identifier' || node.type === 'attribute')
      document.references.push({ name: node.text.slice(0, 180), scope, owner, ref: ref(node) });
    for (const child of children(node)) visit(child, scope, owner);
  }
  try {
    visit(tree.rootNode, [], `file:${file.path}`);
  } finally {
    tree.delete();
  }
  return document;
}
