import { t } from '@skaro/ui';
import { onDestroy } from 'svelte';
import { ChatList } from './chat-list.svelte';
import type { ChatScreenProps } from './chat-screen-props';
export function createChatScreenController(p: ChatScreenProps) {
  const NEW_CHAT = 'new';

  // The screen is keyed by project.
  // svelte-ignore state_referenced_locally
  const list = new ChatList(p.project.id);
  onDestroy(() => list.dispose());

  let tab = $state<'active' | 'archive'>('active');

  // First visit: the latest active chat, or the start screen when there is none.
  $effect(() => {
    if (list.loaded && p.chat === undefined) {
      p.chat = list.latest ?? NEW_CHAT;
    }
  });

  $effect(() => {
    list.archived = tab === 'archive';
  });
  const archivedCount = $derived(list.archivedCount);
  const archiveTip = $derived(
    tab === 'archive'
      ? t('chat.archive.close')
      : archivedCount
        ? t('chat.archive.openN', { n: archivedCount })
        : t('chat.archive.open'),
  );

  function restore(id: string): void {
    void window.skaro.invoke('chat.archive', p.project.id, id, false);
  }

  return {
    p,
    get list() {
      return list;
    },
    get tab() {
      return tab;
    },
    set tab(value: typeof tab) {
      tab = value;
    },
    get archivedCount() {
      return archivedCount;
    },
    get archiveTip() {
      return archiveTip;
    },
    restore,
  };
}
export type ChatScreenController = ReturnType<typeof createChatScreenController>;
