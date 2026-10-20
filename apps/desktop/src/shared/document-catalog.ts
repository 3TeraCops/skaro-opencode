import type { DocEntry } from './ipc-entities';

export type DocumentKind = 'adr' | 'spec' | 'doc';
export interface DocumentCatalog {
  revision: number;
  counts: Record<DocumentKind, number>;
  fixed: DocEntry[];
  nextSpec: string;
}
export interface DocumentCatalogMethods {
  'docs.catalog': (projectId: string) => DocumentCatalog;
  'docs.page': (projectId: string, kind: DocumentKind, start: number) => DocEntry[];
  'docs.lookup': (
    projectId: string,
    key: { path: string } | { kind: DocumentKind; id: string },
  ) => DocEntry | undefined;
}
