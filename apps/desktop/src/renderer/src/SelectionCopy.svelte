<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Icon, addMessages, t } from '@skaro/ui';
  addMessages('ru', { 'selection.copy': 'Скопировать' });
  addMessages('en', { 'selection.copy': 'Copy' });
  let popup = $state<HTMLDivElement>();
  let position = $state<{ left: number; top: number }>();
  let dragging = false;
  let input: HTMLInputElement | HTMLTextAreaElement | undefined;

  function refresh(): void {
    if (dragging) return;
    const active = document.activeElement;
    if (popup?.contains(active)) return;
    input =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && active.type !== 'password')
        ? active
        : undefined;
    const selection = getSelection();
    const selectedInput =
      input &&
      input.selectionStart !== null &&
      input.selectionEnd !== null &&
      input.selectionEnd > input.selectionStart;
    const range =
      selection?.rangeCount && !selection.isCollapsed && selection.toString().trim()
        ? selection.getRangeAt(0)
        : undefined;
    const rect = selectedInput ? input!.getBoundingClientRect() : range?.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height) || rect.bottom < 0 || rect.top > innerHeight) {
      position = undefined;
      return;
    }
    const width = popup?.offsetWidth || 130;
    position = {
      left: Math.max(8, Math.min(innerWidth - width - 8, rect.left)),
      top: Math.max(8, Math.min(innerHeight - 36, rect.top > 40 ? rect.top - 36 : rect.bottom + 8)),
    };
  }

  function copy(): void {
    // Dispatch the native copy event so virtual feeds and CodeMirror can supply their full text.
    input?.focus({ preventScroll: true });
    document.execCommand('copy');
    position = undefined;
  }

  $effect(() => {
    if (!popup) return;
    if (position && !popup.matches(':popover-open')) popup.showPopover();
    else if (!position && popup.matches(':popover-open')) popup.hidePopover();
  });

  onMount(() => {
    const down = (event: PointerEvent) => {
      if (popup?.contains(event.target as Node)) return;
      dragging = true;
      position = undefined;
    };
    const up = () => {
      dragging = false;
      refresh();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') position = undefined;
      else refresh();
    };
    document.addEventListener('selectionchange', refresh);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('keyup', keys);
    document.addEventListener('scroll', refresh, true);
    return () => {
      document.removeEventListener('selectionchange', refresh);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('keyup', keys);
      document.removeEventListener('scroll', refresh, true);
    };
  });
</script>

<div
  bind:this={popup}
  popover="manual"
  class="selection-copy"
  style:left="{position?.left ?? 0}px"
  style:top="{position?.top ?? 0}px"
>
  <Button
    size="sm"
    onpointerdown={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onclick={copy}
  >
    <Icon name="copy" size={14} />{t('selection.copy')}
  </Button>
</div>

<style>
  .selection-copy {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 5px;
    border: 0;
    border-radius: var(--sk-radius-card);
    background: var(--sk-menu);
    box-shadow: var(--sk-menu-shadow);
  }
</style>
