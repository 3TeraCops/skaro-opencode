import type { DocEntry, DocRecord } from '../../shared/ipc-entities';
import type { DocumentCatalog, DocumentKind } from '../../shared/document-catalog';
import type { ArtifactCatalog } from './artifact-catalog';

type Row = Record<string, unknown>;
/** Only indexed document metadata crosses IPC; membership never scans every document body. */
export function documentCatalog(catalog: ArtifactCatalog) {
  const db = catalog.store.db;
  function entry(row: Row): DocEntry {
    const value = JSON.parse(String(row['value'])) as DocEntry & DocRecord;
    const kind = String(row['kind']) as DocEntry['kind'];
    const record: DocRecord = {
      id: value.id,
      status: value.status,
      ...(value.replaces ? { replaces: value.replaces } : {}),
      ...(value.replacedBy ? { replacedBy: value.replacedBy } : {}),
      ...(value.date ? { date: value.date } : {}),
    };
    return {
      kind,
      title: value.title,
      path: String(row['path']),
      editedAt: Number(row['mtime']),
      ...(kind === 'spec' ? { spec: record } : kind === 'adr' ? { adr: record } : {}),
    };
  }
  return {
    'catalog.invalidate': (root: string, paths?: string[]) => catalog.invalidate(root, paths),
    'catalog.documents': async (root: string): Promise<DocumentCatalog> => {
      await catalog.ensure(root);
      const counts = { adr: 0, spec: 0, doc: 0 };
      for (const row of db
        .prepare(
          `SELECT kind,COUNT(*) AS total FROM artifact_catalog
        WHERE root=? AND kind IN ('adr','spec','doc') GROUP BY kind`,
        )
        .all(root))
        counts[row['kind'] as DocumentKind] = Number(row['total']);
      const max = db
        .prepare(
          "SELECT MAX(CAST(id AS INTEGER)) AS id FROM artifact_catalog WHERE root=? AND kind='spec'",
        )
        .get(root);
      const fixed = db
        .prepare("SELECT * FROM artifact_catalog WHERE root=? AND kind IN ('brief','architecture')")
        .all(root)
        .map(entry);
      const revision = Number(
        db.prepare('SELECT revision FROM artifact_roots WHERE root=?').get(root)?.['revision'] ?? 0,
      );
      return {
        revision,
        counts,
        fixed,
        nextSpec: `SPEC-${String(Number(max?.['id'] ?? 0) + 1).padStart(4, '0')}`,
      };
    },
    'catalog.documentPage': async (
      root: string,
      kind: DocumentKind,
      start: number,
    ): Promise<DocEntry[]> => {
      await catalog.ensure(root);
      start = Math.max(0, Math.floor(start));
      return db
        .prepare(
          `SELECT c.* FROM artifact_order p JOIN artifact_catalog c ON c.root=p.root AND c.path=p.path
        WHERE p.root=? AND p.kind=? AND p.position>=? AND p.position<? ORDER BY p.position`,
        )
        .all(root, kind, start, start + 16)
        .map(entry);
    },
    'catalog.document': async (
      root: string,
      key: { path: string } | { kind: DocumentKind; id: string },
    ) => {
      await catalog.ensure(root);
      const row =
        'path' in key
          ? db
              .prepare(
                "SELECT * FROM artifact_catalog WHERE root=? AND path=? AND kind IN ('brief','architecture','doc','adr','spec')",
              )
              .get(root, key.path)
          : db
              .prepare(
                'SELECT * FROM artifact_catalog WHERE root=? AND kind=? AND id=? ORDER BY path LIMIT 1',
              )
              .get(root, key.kind, key.id);
      return row ? entry(row) : undefined;
    },
  };
}
