import {
  getFields,
  parseMarkdown,
  serializeMarkdown,
  setFields,
} from '../artifacts/frontmatter.ts';

/** Packages preserve the same explicit replaces/replaced_by contract as individual artifacts. */
export function applyC4Replacements(documents: Map<string, string>, changed: Set<string>): void {
  for (const path of [...changed]) {
    const group = /^(adr|specs)\/(\d{4})-/.exec(path);
    if (!group) continue;
    const fields = getFields(parseMarkdown(documents.get(path)!));
    if (fields.status !== 'accepted' || fields.replaces === undefined) continue;
    const replaces = String(fields.replaces)
      .replace(/^(ADR|SPEC)-/i, '')
      .padStart(4, '0');
    if (!/^\d{4}$/.test(replaces) || replaces === group[2])
      throw new Error(`${path}: invalid replaces`);
    const previousPath = [...documents.keys()].find((p) =>
      p.startsWith(`${group[1]}/${replaces}-`),
    );
    if (!previousPath) throw new Error(`${path}: replaced document ${replaces} is missing`);
    const previous = parseMarkdown(documents.get(previousPath)!);
    const old = getFields(previous);
    if (old.replaced_by && old.replaced_by !== group[2])
      throw new Error(`${path}: document ${replaces} was already replaced`);
    setFields(previous, { status: 'superseded', replaced_by: group[2] });
    documents.set(previousPath, serializeMarkdown(previous));
    changed.add(previousPath);
  }
}
