import type { PayloadStore } from './payload-store';
import type { ChatView, TaskView } from '../../shared/ipc-sessions';
/** A bounded presentation cache only. Commands and canonical history never depend on it. */
export function saveSessionCache(
  store: PayloadStore,
  key: string,
  value: ChatView | TaskView,
): void {
  if (!/^(chat|task)\.[\w-]+\.[\w-]+$/.test(key)) throw new Error('Invalid session cache key');
  const text = JSON.stringify(value);
  if (text.length > 512_000) return;
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS shell_sessions (key TEXT PRIMARY KEY,at INTEGER NOT NULL,value TEXT NOT NULL)',
  );
  store.transaction(() => {
    store.db
      .prepare(
        `INSERT INTO shell_sessions VALUES (?,?,?) ON CONFLICT(key)
      DO UPDATE SET at=excluded.at,value=excluded.value`,
      )
      .run(key, Date.now(), text);
    store.db.exec(
      'DELETE FROM shell_sessions WHERE key NOT IN (SELECT key FROM shell_sessions ORDER BY at DESC LIMIT 8)',
    );
  });
}
