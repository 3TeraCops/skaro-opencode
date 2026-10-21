import type { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

/** Expire metadata first; interrupted, bounded row cleanup resumes on the next job. */
export async function pruneSnapshots(
  db: DatabaseSync,
  retained: (string | undefined)[],
): Promise<void> {
  const deadline = performance.now() + 1000;
  db.exec('BEGIN IMMEDIATE');
  try {
    const expired = (db.prepare('SELECT id FROM snapshots').all() as { id: string }[]).filter(
      ({ id }) => !retained.includes(id),
    );
    for (const { id } of expired) {
      db.prepare('INSERT OR IGNORE INTO garbage VALUES(?)').run(id);
      db.prepare('DELETE FROM snapshots WHERE id=?').run(id);
      db.prepare('DELETE FROM metadata WHERE key IN (?,?)').run(`model:${id}`, `overview:${id}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const { snapshot } of db.prepare('SELECT snapshot FROM garbage').all() as {
    snapshot: string;
  }[]) {
    for (const table of ['nodes', 'edges', 'unresolved', 'search']) {
      const remove = db.prepare(`DELETE FROM ${table} WHERE rowid IN
        (SELECT rowid FROM ${table} WHERE snapshot=? LIMIT 500)`);
      while (remove.run(snapshot).changes) {
        // Give interactive reads I/O priority; the journal resumes unfinished work.
        if (performance.now() >= deadline) return;
        await setTimeout(10);
      }
    }
    db.prepare('DELETE FROM garbage WHERE snapshot=?').run(snapshot);
  }
}
