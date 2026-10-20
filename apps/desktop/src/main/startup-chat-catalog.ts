import { dirname } from 'node:path';
import type { BootstrapState, TabsState, WorkspaceState } from '../shared/ipc-sessions';
import { ChatCatalogReader } from './background/chat-catalog';

/** The first frame reads at most 32 indexed metadata rows, never a history or the whole catalog. */
export function startupChatCatalog(
  file: string,
  workspace: WorkspaceState | undefined,
  tabs: TabsState,
): BootstrapState['chatCatalog'] {
  const project = tabs.active;
  if (!project || workspace?.view !== 'project' || workspace.sections[project] !== 'chat') return;
  let reader: ChatCatalogReader | undefined;
  try {
    reader = new ChatCatalogReader(dirname(file));
    const first = reader.query(project, false);
    if (first.source.count <= first.chats.length) return first;
    const next = reader.page(first.source, 16);
    return next.source.revision === first.source.revision
      ? { ...first, chats: [...first.chats, ...next.chats] }
      : first;
  } catch {
    // The regular asynchronous catalog still reports/recovers an unavailable read model.
    return;
  } finally {
    reader?.close();
  }
}
