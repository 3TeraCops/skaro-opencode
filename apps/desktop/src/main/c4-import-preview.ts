import { parseMarkdown, type ProjectArtifacts } from '@skaro/core';
import type { ImportState, StagedArtifact } from './import-model';
import { docName } from './import-current';

export function c4ImportBody(
  state: ImportState,
  item: StagedArtifact,
  artifacts: ProjectArtifacts,
): string {
  const pkg = state.c4Package;
  if (!pkg) return item.body;
  let path = item.type === 'doc' ? `docs/${docName(item)}` : `${item.type}.md`;
  if (item.type === 'spec' || item.type === 'adr') {
    const existing = item.type === 'spec' ? artifacts.specs : artifacts.adrs;
    const next = Math.max(0, ...existing.map((s) => Number(s.id))) + 1;
    const newItems = state.staged.filter((s) => s.type === item.type && !s.updates);
    const id = item.updates ?? String(next + newItems.indexOf(item)).padStart(4, '0');
    path =
      pkg.files.find((f) => f.path.startsWith(`${item.type === 'spec' ? 'specs' : 'adr'}/${id}-`))
        ?.path ?? '';
  }
  const document = pkg.files.find((f) => f.path === path);
  return document ? parseMarkdown(document.after).body : item.body;
}

/** Architecture-bearing import entries form one consistent selection, using existing dependency UI. */
export function c4ImportRefs(state: ImportState, item: StagedArtifact): string[] {
  if (!state.c4 || !['architecture', 'spec', 'adr'].includes(item.type)) return [];
  return state.staged
    .filter((s) => ['architecture', 'spec', 'adr'].includes(s.type) && s.key !== item.key)
    .map((s) => s.key);
}
