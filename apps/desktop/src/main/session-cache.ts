import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BootstrapState,
  ChatView,
  TaskView,
  TabsState,
  WorkspaceState,
} from '../shared/ipc-sessions';
/** The first frame reads only the saved viewport of the selected conversation. */
export function cachedSession(
  file: string,
  workspace: WorkspaceState | undefined,
  tabs: TabsState,
): BootstrapState['sessions'] {
  const project = tabs.active;
  if (!project || workspace?.view !== 'project') return;
  const section = workspace.sections[project];
  const owner =
    section === 'chat'
      ? workspace.openChats[project]
      : section === 'tasks'
        ? workspace.openTasks[project]
        : undefined;
  if (!owner || owner === 'new') return;
  const key = `${section === 'chat' ? 'chat' : 'task'}.${project}.${owner}`;
  const path = join(dirname(file), 'registry.db');
  if (!existsSync(path)) return;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shell_sessions'").get()
    )
      return;
    const row = db.prepare('SELECT value FROM shell_sessions WHERE key=?').get(key);
    return row ? { [key]: JSON.parse(String(row['value'])) as ChatView | TaskView } : undefined;
  } catch {
    return;
  } finally {
    db?.close();
  }
}
