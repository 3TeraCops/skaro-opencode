import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ProjectCard } from '../shared/ipc';

/** The shell reads only its cached viewport; this database is never a writer of owner commands. */
export function cachedProjectCards(appDb: string, ids: string[]): ProjectCard[] {
  const path = join(dirname(appDb), 'registry.db');
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_cards'").get()
    )
      return [];
    const query = db.prepare('SELECT value FROM project_cards WHERE id=?');
    return ids.flatMap((id) => {
      const row = query.get(id);
      return row ? [JSON.parse(String(row['value'])) as ProjectCard] : [];
    });
  } finally {
    db.close();
  }
}
