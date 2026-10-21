import { DbTable } from './table.ts';
import type { DatabaseSync } from 'node:sqlite';

const legacyRecords = `SELECT json_extract(entry.value,'$.id') AS id, entry.value AS value, entry.key AS position
  FROM json_each((SELECT value FROM settings WHERE key=?)) AS entry
  WHERE json_type(entry.value,'$.id')='text'`;
interface RecordRow {
  id: string;
  value: string;
}

/** Individually indexed durable operations. Legacy arrays migrate transactionally, once. */
export class DbCollections extends DbTable {
  private readonly readOnly: boolean;
  constructor(db: DatabaseSync, now: () => number, readOnly = false) {
    super(db, now);
    this.readOnly = readOnly;
  }
  private migrated(key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM collection_migrations WHERE key=?').get(key);
  }
  private ensure(key: string): void {
    if (this.migrated(key)) return;
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO collection_records (collection,id,value)
           SELECT ?, id, value FROM (${legacyRecords})`,
        )
        .run(key, key);
      this.db.prepare('INSERT INTO collection_migrations VALUES (?)').run(key);
    });
  }
  private records(key: string, id?: string): RecordRow[] {
    if (!this.readOnly) this.ensure(key);
    // One SELECT keeps canonical rows and migration state in the same SQLite snapshot.
    const sql = `SELECT id,value FROM (
      SELECT id,value,0 AS priority,rowid AS position FROM collection_records WHERE collection=?
      ${
        this.readOnly
          ? `UNION ALL SELECT id,value,1 AS priority,position FROM (${legacyRecords})
        WHERE NOT EXISTS (SELECT 1 FROM collection_migrations WHERE key=?)`
          : ''
      }
    ) ${id === undefined ? '' : 'WHERE id=?'} ORDER BY priority,position ${id === undefined ? '' : 'LIMIT 1'}`;
    const parameters = this.readOnly ? [key, key, key] : [key];
    if (id !== undefined) parameters.push(id);
    return this.db.prepare(sql).all(...parameters) as unknown as RecordRow[];
  }
  all<T>(key: string): T[] {
    const rows: RecordRow[] = [],
      known = new Set<string>();
    for (const row of this.records(key)) {
      if (known.has(row.id)) continue;
      known.add(row.id);
      rows.push(row);
    }
    return rows.map((row) => JSON.parse(row.value) as T);
  }
  get<T>(key: string, id: string): T | undefined {
    const row = this.records(key, id)[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  put<T extends { id: string }>(key: string, value: T): void {
    this.ensure(key);
    this.db
      .prepare(
        `INSERT INTO collection_records VALUES (?,?,?)
      ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value`,
      )
      .run(key, value.id, JSON.stringify(value));
  }
}
