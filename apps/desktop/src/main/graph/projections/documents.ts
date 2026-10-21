import { parse } from 'yaml';
import { posix } from 'node:path';
import type { Facts, SourceFile } from '../facts';

export function projectDocuments(
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
): void {
  const documents = files.filter((file) => file.language === 'markdown');
  const identifiers = new Map<string, string>();
  const metadata = new Map<string, Record<string, unknown>>();
  for (const file of documents) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(file.text);
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = match ? parse(match[1]!, { maxAliasCount: 20 }) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        data = parsed as Record<string, unknown>;
    } catch (error) {
      diagnostic(file.path, String(error));
    }
    const node = facts.nodes.get(`file:${file.path}`)!;
    node.name =
      typeof data.title === 'string'
        ? data.title
        : (/^#\s+(.+)$/m.exec(file.text)?.[1] ?? node.name);
    if (typeof data.id === 'string' || typeof data.id === 'number') {
      const number = String(data.id);
      const identifier = file.path.includes('/specs/')
        ? `SPEC-${number.padStart(4, '0')}`
        : file.path.includes('/adr/')
          ? `ADR-${number.padStart(4, '0')}`
          : number;
      identifiers.set(identifier, node.id);
      node.attributes.artifactId = identifier;
      if (/^T-\d+$/.test(identifier)) node.kind = 'task';
      else if (/^M\d+$/.test(identifier)) node.kind = 'milestone';
    }
    if (typeof data.status === 'string') node.attributes.status = data.status;
    metadata.set(file.path, data);
    const spec = String(node.attributes.artifactId ?? '');
    if (spec.startsWith('SPEC-')) {
      const authored = file.text.replace(/```skaro-c4[\s\S]*?```/g, (block) =>
        block.replace(/[^\r\n]/g, ' '),
      );
      for (const match of authored.matchAll(/\bR-\d+\b/g)) {
        const id = `requirement:${spec}:${match[0]}`;
        if (facts.nodes.has(id)) continue;
        facts.node({
          id,
          kind: 'requirement',
          name: `${spec} · ${match[0]}`,
          origin: 'extracted-document',
          sources: [facts.ref(file, match.index, match.index + match[0].length)],
          attributes: { specification: spec },
        });
        facts.edge(
          node.id,
          id,
          'contains',
          facts.ref(file),
          'markdown/requirement',
          'Requirement ID explicitly occurs in this specification',
          'extracted-document',
          'explicit',
        );
      }
    }
  }
  for (const file of documents) {
    const owner = `file:${file.path}`,
      data = metadata.get(file.path)!;
    for (const link of file.text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const path = link[1]!.split('#')[0]!;
      if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) continue;
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        continue;
      }
      const target = `file:${posix.normalize(posix.join(posix.dirname(file.path), decoded))}`;
      if (facts.nodes.has(target))
        facts.edge(
          owner,
          target,
          'references',
          facts.ref(file, link.index, link.index + link[0].length),
          'markdown/link',
          'Explicit local Markdown link',
          'extracted-document',
          'explicit',
        );
      else
        facts.missing(
          owner,
          path,
          'references',
          facts.ref(file, link.index, link.index + link[0].length),
          'Local Markdown link target is absent or excluded',
        );
    }
    const add = (value: unknown, kind: 'depends-on' | 'covers' | 'contains', prefix = '') => {
      if (typeof value !== 'string' && typeof value !== 'number') return;
      const key = prefix
        ? prefix +
          String(value)
            .replace(/^SPEC-/, '')
            .padStart(4, '0')
        : String(value);
      const target = identifiers.get(key);
      if (target)
        facts.edge(
          kind === 'contains' ? target : owner,
          kind === 'contains' ? owner : target,
          kind,
          facts.ref(file),
          'markdown/frontmatter',
          `Explicit artifact field binding: ${key}`,
          'extracted-document',
          'explicit',
        );
    };
    for (const dependency of Array.isArray(data.depends_on) ? data.depends_on : [])
      add(dependency, 'depends-on');
    add(data.spec, 'covers', 'SPEC-');
    add(data.milestone, 'contains');
  }
}
