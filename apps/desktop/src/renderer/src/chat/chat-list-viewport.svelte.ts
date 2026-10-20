import { tick } from 'svelte';
import type { ChatScreenController } from './chat-screen-controller.svelte';

/** Selection and native keyboard focus follow chat identity across sorted page revisions. */
export function chatListViewport(options: {
  state(): ChatScreenController;
  root(): HTMLElement | undefined;
  reveal(index: number): Promise<void> | undefined;
}) {
  let revealed: string | undefined;
  const row = (id: string) =>
    options.root()?.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"]`);
  $effect(() => {
    const state = options.state();
    const id = state.p.chat;
    const tab = state.tab;
    void state.list.revision;
    const key = `${id}:${tab}`;
    let cancelled = false;
    if (id && id !== 'new' && key !== revealed)
      void (async () => {
        const index = await state.list.find(id);
        await tick();
        if (cancelled || state.tab !== tab || index < 0) return;
        const current = row(id);
        if (current) current.scrollIntoView({ block: 'nearest' });
        else await options.reveal(index);
        if (!cancelled) revealed = key;
      })();
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    const root = options.root();
    if (!root) return;
    let held: { id: string; element: HTMLElement } | undefined;
    let restoring = false;
    let cancelled = false;
    const focus = (event: FocusEvent) => {
      const element = event.target as HTMLElement;
      const id = element.closest<HTMLElement>('[data-chat-id]')?.dataset['chatId'];
      held = id ? { id, element } : undefined;
    };
    const blur = () =>
      queueMicrotask(() => {
        if (
          !root.contains(document.activeElement) &&
          (document.activeElement !== document.body || held?.element.isConnected)
        )
          held = undefined;
      });
    const observer = new MutationObserver(() => {
      const original = held;
      if (
        restoring ||
        !original ||
        original.element.isConnected ||
        document.activeElement !== document.body
      )
        return;
      restoring = true;
      void (async () => {
        const index = await options.state().list.find(original.id);
        if (cancelled || index < 0 || document.activeElement !== document.body) return;
        const current = row(original.id);
        if (current) current.scrollIntoView({ block: 'nearest' });
        else await options.reveal(index);
        if (!cancelled && document.activeElement === document.body)
          row(original.id)?.focus({ preventScroll: true });
      })().finally(() => {
        restoring = false;
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    return () => {
      cancelled = true;
      observer.disconnect();
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', blur);
    };
  });
}
