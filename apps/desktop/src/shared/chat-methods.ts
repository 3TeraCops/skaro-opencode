import type { InteractionAnswer } from '@skaro/timeline';
import type { ChatCatalogMethods } from './chat-catalog';
import type {
  ChatSummary,
  ChatSettings,
  ChatView,
  MessageInput,
  ProposalAction,
} from './ipc-sessions';

export interface ChatMethods extends ChatCatalogMethods {
  /** Project chats, active and archived, most recent first. */
  'chats.list': (projectId: string) => ChatSummary[];
  /** Agent, model and effort a new chat starts with. */
  'chats.defaults': (projectId: string) => ChatSettings;
  'chat.open': (projectId: string, chatId: string, options?: { paged: boolean }) => ChatView;
  /** Starts a chat with its first message. */
  'chat.create': (projectId: string, settings: ChatSettings, input: MessageInput) => ChatSummary;
  'chat.send': (projectId: string, chatId: string, input: MessageInput) => void;
  'chat.respond': (
    projectId: string,
    chatId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ) => void;
  'chat.interrupt': (projectId: string, chatId: string) => void;
  'chat.setSettings': (projectId: string, chatId: string, settings: ChatSettings) => void;
  'chat.archive': (projectId: string, chatId: string, archived: boolean) => void;
  'chat.proposal': (
    projectId: string,
    chatId: string,
    itemId: string,
    action: ProposalAction,
  ) => void;
}
