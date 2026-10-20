import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Worker-owned, indexed records and immutable deduplicated text. Never serialize a project array. */
export class PayloadStore {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  constructor(dataDir: string, filename = 'workspace.db') {
    this.dataDir = dataDir;
    this.db = new DatabaseSync(join(dataDir, filename));
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS content (id TEXT PRIMARY KEY, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        project TEXT NOT NULL, id TEXT PRIMARY KEY, owner TEXT NOT NULL,
        state TEXT NOT NULL, metadata TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_owner ON records(project, owner);
      CREATE INDEX IF NOT EXISTS records_state ON records(project, state);
      CREATE TABLE IF NOT EXISTS migrations (key TEXT PRIMARY KEY);`);
  }
  text(text: string): string {
    const id = createHash('sha256').update(text).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO content VALUES (?, ?)').run(id, text);
    return id;
  }
  read(id: string): string {
    const row = this.db.prepare('SELECT text FROM content WHERE id=?').get(id);
    if (!row) throw new Error(`Missing immutable content ${id}`);
    return String(row['text']);
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
