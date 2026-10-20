import type { ChatSummary } from './ipc-sessions';

export interface ChatRange {
  projectId: string;
  archived: boolean;
  revision: number;
  count: number;
}
export interface ChatPage {
  source: ChatRange;
  start: number;
  chats: ChatSummary[];
}
export interface ChatCatalog extends ChatPage {
  activeCount: number;
  archivedCount: number;
  latest?: string;
}
export interface ChatCatalogMethods {
  'chats.query': (projectId: string, archived: boolean) => ChatCatalog;
  'chats.page': (source: ChatRange, start: number) => ChatPage;
  'chats.find': (source: ChatRange, id: string) => { source: ChatRange; index: number };
}
