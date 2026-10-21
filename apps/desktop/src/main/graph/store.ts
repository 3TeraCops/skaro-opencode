import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { C4Model } from '@skaro/core/c4-view';
import type {
  GraphSnapshot,
  GraphNode,
  GraphEdge,
  UnresolvedReference,
} from '@skaro/core/graph-view';
import type { Facts, FileFacts } from './facts';
import { overview } from './overview';
import { pruneSnapshots } from './store-prune';

export class GraphStore {
  readonly db: DatabaseSync;
  constructor(file: string, readOnly = false) {
    if (readOnly) {
      this.db = new DatabaseSync(file, { readOnly: true });
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON;');
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS garbage (snapshot TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS nodes (snapshot TEXT, id TEXT, kind TEXT, origin TEXT, state TEXT,
        name TEXT, qualified TEXT, path TEXT, data TEXT, PRIMARY KEY(snapshot,id));
      CREATE INDEX IF NOT EXISTS node_kind ON nodes(snapshot,kind,state);
      CREATE INDEX IF NOT EXISTS node_path ON nodes(snapshot,path);
      CREATE TABLE IF NOT EXISTS edges (snapshot TEXT, id TEXT, source TEXT, target TEXT,
        kind TEXT, resolution TEXT, data TEXT, PRIMARY KEY(snapshot,id));
      CREATE INDEX IF NOT EXISTS edge_source ON edges(snapshot,source,kind);
      CREATE INDEX IF NOT EXISTS edge_target ON edges(snapshot,target,kind);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT, version TEXT, facts TEXT);
      CREATE TABLE IF NOT EXISTS unresolved (snapshot TEXT, source TEXT, data TEXT);
      CREATE INDEX IF NOT EXISTS unresolved_source ON unresolved(snapshot,source);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(snapshot UNINDEXED,id UNINDEXED,name,qualified,path,tokenize='unicode61');
    `);
  }
  meta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  setMeta(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, JSON.stringify(value));
  }
  current(): GraphSnapshot | undefined {
    const id = this.meta<string>('current');
    return id ? this.snapshot(id) : undefined;
  }
  snapshot(id: string): GraphSnapshot | undefined {
    const row = this.db.prepare('SELECT data FROM snapshots WHERE id=?').get(id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as GraphSnapshot) : undefined;
  }
  cached<T = FileFacts>(path: string, hash: string, version: string): T | undefined {
    const row = this.db
      .prepare('SELECT facts FROM files WHERE path=? AND hash=? AND version=?')
      .get(path, hash, version) as { facts: string } | undefined;
    return row ? (JSON.parse(row.facts) as T) : undefined;
  }
  saveFile(path: string, hash: string, version: string, facts: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO files VALUES(?,?,?,?)')
      .run(path, hash, version, JSON.stringify(facts));
  }
  publish(snapshot: GraphSnapshot, facts: Facts, model: C4Model | null, verify?: () => void): void {
    verify?.();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const node = this.db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?)');
      const search = this.db.prepare('INSERT INTO search VALUES(?,?,?,?,?)');
      for (const data of facts.nodes.values()) {
        node.run(
          snapshot.id,
          data.id,
          data.kind,
          data.origin,
          data.state ?? '',
          data.name,
          data.qualifiedName ?? '',
          data.sources[0]?.path ?? '',
          JSON.stringify(data),
        );
        search.run(
          snapshot.id,
          data.id,
          data.name,
          data.qualifiedName ?? '',
          data.sources[0]?.path ?? '',
        );
      }
      const edge = this.db.prepare('INSERT INTO edges VALUES(?,?,?,?,?,?,?)');
      for (const data of facts.edges.values())
        if (facts.nodes.has(data.source) && facts.nodes.has(data.target))
          edge.run(
            snapshot.id,
            data.id,
            data.source,
            data.target,
            data.kind,
            data.resolution,
            JSON.stringify(data),
          );
      const unresolved = this.db.prepare('INSERT INTO unresolved VALUES(?,?,?)');
      for (const data of facts.unresolved)
        unresolved.run(snapshot.id, data.source, JSON.stringify(data));
      this.db
        .prepare('INSERT INTO snapshots VALUES(?,?)')
        .run(snapshot.id, JSON.stringify(snapshot));
      this.setMeta(`model:${snapshot.id}`, model);
      this.setMeta(
        `overview:${snapshot.id}`,
        overview(this, {
          projectId: snapshot.projectId,
          checkoutId: snapshot.checkoutId,
          snapshotId: snapshot.id,
          requestId: 'background-overview',
          operation: 'overview',
          filter: { state: 'current' },
        }),
      );
      verify?.();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  prune(): Promise<void> {
    return pruneSnapshots(this.db, [this.meta<string>('current'), this.meta<string>('previous')]);
  }
  nodes(snapshot: string, ids: string[]): GraphNode[] {
    const read = this.db.prepare('SELECT data FROM nodes WHERE snapshot=? AND id=?');
    return ids.flatMap((id) => {
      const row = read.get(snapshot, id) as { data: string } | undefined;
      return row ? [JSON.parse(row.data) as GraphNode] : [];
    });
  }
  edges(snapshot: string, ids: string[]): GraphEdge[] {
    const read = this.db.prepare('SELECT data FROM edges WHERE snapshot=? AND id=?');
    return ids.flatMap((id) => {
      const row = read.get(snapshot, id) as { data: string } | undefined;
      return row ? [JSON.parse(row.data) as GraphEdge] : [];
    });
  }
  unresolved(snapshot: string, id: string): UnresolvedReference[] {
    return (
      this.db
        .prepare('SELECT data FROM unresolved WHERE snapshot=? AND source=? LIMIT 100')
        .all(snapshot, id) as { data: string }[]
    ).map((row) => JSON.parse(row.data) as UnresolvedReference);
  }
  close(): void {
    this.db.close();
  }
}
