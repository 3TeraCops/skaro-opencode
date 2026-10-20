import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ProjectCard } from '../shared/ipc';

/** The shell reads only its cached viewport; this database is never a writer of owner commands. */
export function cachedProjectCards(appDb: string, ids: string[]): ProjectCard[] {
  const path = join(dirname(appDb), 'registry.db');
  if (!existsSync(path)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_cards'").get()
    )
      return [];
    const query = db.prepare('SELECT value FROM project_cards WHERE id=?');
    return ids.flatMap((id) => {
      const row = query.get(id);
      return row ? [JSON.parse(String(row['value'])) as ProjectCard] : [];
    });
  } catch (error) {
    // A worker may be initializing this optional read model. The indexed async
    // query still loads every card; waiting on its lock must not block first paint.
    if (error && typeof error === 'object' && 'errcode' in error) {
      const code = Number(error.errcode) & 255;
      if (code === 5 || code === 6) return [];
    }
    throw error;
  } finally {
    db?.close();
  }
}
