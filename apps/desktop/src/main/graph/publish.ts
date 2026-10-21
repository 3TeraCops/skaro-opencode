import { DatabaseSync } from 'node:sqlite';
import type { GraphSnapshot } from '@skaro/core/graph-view';

/** Only the scheduler can publish. This tiny metadata write cannot race a main-thread cancel. */
export function publishSnapshot(database: string, snapshot: GraphSnapshot): void {
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA busy_timeout=100; PRAGMA synchronous=NORMAL;');
    db.exec('BEGIN IMMEDIATE');
    if (!db.prepare('SELECT id FROM snapshots WHERE id=?').get(snapshot.id))
      throw new Error('Graph snapshot was not prepared');
    const current = db.prepare('SELECT value FROM metadata WHERE key=?').get('current') as
      { value: string } | undefined;
    if (current && JSON.parse(current.value) !== snapshot.id)
      db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('previous', current.value);
    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(
      'current',
      JSON.stringify(snapshot.id),
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
