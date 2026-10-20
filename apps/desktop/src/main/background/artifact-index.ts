import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarkdown, getFields, type ArtifactReadCache } from '@skaro/core';
import type { PayloadStore } from './payload-store';

type Parsed = { fields: Record<string, unknown>; body: string; title?: string };
/** Reusable per-file projections; external edits are verified by metadata on every load. */
export class ArtifactIndex implements ArtifactReadCache {
  private readonly store: PayloadStore;
  private readonly root: string;
  constructor(store: PayloadStore, root: string) {
    this.store = store;
    this.root = root;
    store.db.exec(`CREATE TABLE IF NOT EXISTS artifact_files (
      root TEXT NOT NULL, path TEXT NOT NULL, fingerprint TEXT NOT NULL, fields TEXT NOT NULL, body TEXT NOT NULL, title TEXT,
      PRIMARY KEY(root, path));
      CREATE TABLE IF NOT EXISTS artifact_projections (
        root TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,
        value TEXT NOT NULL,PRIMARY KEY(root,path,kind))`);
  }
  invalidate(path: string): void {
    this.store.db
      .prepare('DELETE FROM artifact_projections WHERE root=? AND path=?')
      .run(this.root, path);
    this.store.db
      .prepare('DELETE FROM artifact_files WHERE root=? AND path=?')
      .run(this.root, path);
  }
  async project<T>(path: string, kind: string, derive: (parsed: Parsed) => T): Promise<T> {
    const absolute = join(this.root, '.skaro', path);
    const before = await stat(absolute, { bigint: true });
    const fingerprint = `${before.mtimeNs}:${before.ctimeNs}:${before.size}`;
    const saved = this.store.db
      .prepare(
        'SELECT value FROM artifact_projections WHERE root=? AND path=? AND kind=? AND fingerprint=?',
      )
      .get(this.root, path, kind, fingerprint);
    if (saved) return JSON.parse(String(saved['value'])) as T;
    const value = derive(await this.read(path));
    const after = await stat(absolute, { bigint: true });
    if (`${after.mtimeNs}:${after.ctimeNs}:${after.size}` !== fingerprint)
      return this.project(path, kind, derive);
    this.store.db
      .prepare(
        `INSERT INTO artifact_projections VALUES (?,?,?,?,?) ON CONFLICT(root,path,kind)
      DO UPDATE SET fingerprint=excluded.fingerprint,value=excluded.value`,
      )
      .run(this.root, path, kind, fingerprint, JSON.stringify(value));
    return value;
  }
  async read(path: string, includeBody = true): Promise<Parsed> {
    const absolute = join(this.root, '.skaro', path);
    const info = await stat(absolute, { bigint: true });
    const fingerprint = `${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
    const saved = this.store.db
      .prepare(
        `SELECT fields, title${includeBody ? ', body' : ''} FROM artifact_files WHERE root=? AND path=? AND fingerprint=?`,
      )
      .get(this.root, path, fingerprint);
    if (saved)
      return {
        fields: JSON.parse(String(saved['fields'])) as Record<string, unknown>,
        body: includeBody ? String(saved['body']) : '',
        title: saved['title'] ? String(saved['title']) : undefined,
      };
    const source = await readFile(absolute, 'utf8');
    const after = await stat(absolute, { bigint: true });
    if (`${after.mtimeNs}:${after.ctimeNs}:${after.size}` !== fingerprint)
      return this.read(path, includeBody);
    const parsed = parseMarkdown(source);
    const value = {
      fields: getFields(parsed),
      body: parsed.body,
      title: /^#\s+(.+)$/m.exec(parsed.body)?.[1]?.trim(),
    };
    this.store.db
      .prepare(
        `INSERT INTO artifact_files VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(root,path) DO UPDATE SET fingerprint=excluded.fingerprint, fields=excluded.fields, body=excluded.body, title=excluded.title`,
      )
      .run(
        this.root,
        path,
        fingerprint,
        JSON.stringify(value.fields),
        value.body,
        value.title ?? null,
      );
    return { ...value, body: includeBody ? value.body : '' };
  }
}
