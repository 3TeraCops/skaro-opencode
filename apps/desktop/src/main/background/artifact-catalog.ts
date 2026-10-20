import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { toTask, toAdr, toSpec, toMilestone, type ArtifactProblem } from '@skaro/core';
import { ArtifactIndex } from './artifact-index';
import type { PayloadStore } from './payload-store';

/** Reconcile once on startup, then only paths reported by the actual filesystem watcher. */
export class ArtifactCatalog {
  readonly store: PayloadStore;
  private readonly dirty = new Map<string, Set<string> | null>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS artifact_catalog (
      root TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,
      title TEXT NOT NULL,mtime REAL NOT NULL,value TEXT NOT NULL,PRIMARY KEY(root,path));
      CREATE INDEX IF NOT EXISTS artifact_catalog_kind ON artifact_catalog(root,kind,id,path);
      CREATE INDEX IF NOT EXISTS artifact_catalog_id ON artifact_catalog(root,id);
      CREATE TABLE IF NOT EXISTS artifact_order (root TEXT NOT NULL,kind TEXT NOT NULL,
        position INTEGER NOT NULL,path TEXT NOT NULL,PRIMARY KEY(root,kind,position));
      CREATE TABLE IF NOT EXISTS artifact_roots (root TEXT PRIMARY KEY,revision INTEGER NOT NULL)`);
  }
  invalidate(root: string, paths?: string[]): void {
    if (!paths || !this.dirty.has(root)) {
      this.dirty.set(root, null);
      return;
    }
    const pending = this.dirty.get(root);
    if (pending) for (const path of paths) pending.add(path.replaceAll('\\', '/'));
  }
  async ensure(root: string): Promise<void> {
    const active = this.pending.get(root);
    if (active) {
      await active;
      return this.ensure(root);
    }
    const paths = this.dirty.get(root);
    if (paths?.size === 0) return;
    this.dirty.set(root, new Set());
    const work = this.refresh(root, paths ?? null);
    this.pending.set(root, work);
    try {
      await work;
    } catch (error) {
      this.dirty.set(root, null);
      throw error;
    } finally {
      this.pending.delete(root);
    }
    const changed = this.dirty.get(root);
    if (changed === null || changed?.size) await this.ensure(root);
  }
  private async refresh(root: string, dirty: Set<string> | null): Promise<void> {
    const paths = dirty ? [...dirty] : ['brief.md', 'architecture.md'];
    if (!dirty)
      for (const folder of ['adr', 'specs', 'docs', 'tasks', 'milestones']) {
        const names = await readdir(join(root, '.skaro', folder)).catch(() => []);
        paths.push(
          ...names
            .filter((name) => name.endsWith('.md'))
            .sort()
            .map((name) => `${folder}/${name}`),
        );
      }
    if (
      dirty?.size &&
      paths.some(
        (path) => !path.includes('.') && /^(adr|specs|docs|tasks|milestones)(\/|$)/.test(path),
      )
    ) {
      return this.refresh(root, null);
    }
    const index = new ArtifactIndex(this.store, root);
    for (let start = 0; start < paths.length; start += 16)
      await Promise.all(
        paths.slice(start, start + 16).map((path) => this.update(root, path, index)),
      );
    if (!dirty) {
      const wanted = new Set(paths.map((path) => `.skaro/${path}`));
      for (const row of this.store.db
        .prepare('SELECT path FROM artifact_catalog WHERE root=?')
        .all(root))
        if (!wanted.has(String(row['path']))) this.remove(root, String(row['path']));
    }
    // Ordering is rebuilt only for a filesystem reconciliation, never for a page read.
    this.store.transaction(() => {
      this.store.db.prepare('DELETE FROM artifact_order WHERE root=?').run(root);
      this.store.db
        .prepare(
          `INSERT INTO artifact_order SELECT root,kind,
        ROW_NUMBER() OVER (PARTITION BY kind ORDER BY id,path)-1,path
        FROM artifact_catalog WHERE root=?`,
        )
        .run(root);
      this.store.db
        .prepare(
          `INSERT INTO artifact_roots VALUES (?,1) ON CONFLICT(root)
        DO UPDATE SET revision=revision+1`,
        )
        .run(root);
    });
  }
  private remove(root: string, path: string): void {
    this.store.db.prepare('DELETE FROM artifact_catalog WHERE root=? AND path=?').run(root, path);
  }
  private async update(root: string, path: string, index: ArtifactIndex): Promise<void> {
    const full = `.skaro/${path}`;
    const folder = path.split('/')[0];
    const kind =
      path === 'brief.md'
        ? 'brief'
        : path === 'architecture.md'
          ? 'architecture'
          : (
              {
                adr: 'adr',
                specs: 'spec',
                docs: 'doc',
                tasks: 'task',
                milestones: 'milestone',
              } as Record<string, string>
            )[folder!];
    if (!kind || !path.endsWith('.md')) return;
    try {
      const parsed = await index.read(path, false);
      const file = await stat(join(root, full));
      const problems: ArtifactProblem[] = [];
      const converters: Record<
        string,
        | ((
            fields: Record<string, unknown>,
            body: string,
            path: string,
            problems: ArtifactProblem[],
          ) => { id: string; title: string } | undefined)
        | undefined
      > = { task: toTask, adr: toAdr, spec: toSpec, milestone: toMilestone };
      const converter = converters[kind];
      const title = String(
        parsed.fields['title'] ?? parsed.title ?? path.split('/').pop()!.replace(/\.md$/, ''),
      );
      const value = converter
        ? converter(parsed.fields, '', full, problems)
        : { kind, path: full, title: kind === 'doc' ? path.split('/').pop()! : title };
      if (!value) {
        this.remove(root, full);
        return;
      }
      const id = 'id' in value ? value.id : full;
      this.store.db
        .prepare(
          `INSERT INTO artifact_catalog VALUES (?,?,?,?,?,?,?) ON CONFLICT(root,path)
        DO UPDATE SET kind=excluded.kind,id=excluded.id,title=excluded.title,mtime=excluded.mtime,value=excluded.value
        WHERE artifact_catalog.value<>excluded.value OR artifact_catalog.mtime<>excluded.mtime`,
        )
        .run(root, full, kind, id, value.title, file.mtimeMs, JSON.stringify(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.remove(root, full);
        return;
      }
      throw error;
    }
  }
}
