import { DbTable } from './table.ts';

/** Individually indexed durable operations. Legacy arrays migrate transactionally, once. */
export class DbCollections extends DbTable {
  private ensure(key: string): void {
    if (this.db.prepare('SELECT 1 FROM collection_migrations WHERE key=?').get(key)) return;
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO collection_records (collection,id,value)
        SELECT ?, json_extract(entry.value,'$.id'), entry.value
        FROM json_each((SELECT value FROM settings WHERE key=?)) AS entry
        WHERE json_type(entry.value,'$.id')='text'`,
        )
        .run(key, key);
      this.db.prepare('INSERT INTO collection_migrations VALUES (?)').run(key);
    });
  }
  all<T>(key: string): T[] {
    this.ensure(key);
    return this.db
      .prepare('SELECT value FROM collection_records WHERE collection=? ORDER BY rowid')
      .all(key)
      .map((row) => JSON.parse(String(row['value'])) as T);
  }
  get<T>(key: string, id: string): T | undefined {
    this.ensure(key);
    const row = this.db
      .prepare('SELECT value FROM collection_records WHERE collection=? AND id=?')
      .get(key, id);
    return row ? (JSON.parse(String(row['value'])) as T) : undefined;
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
