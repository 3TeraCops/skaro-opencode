<script lang="ts">
  import type { Snippet } from 'svelte';
  /** Shared frame of the existing file-diff viewer. Diagram viewers use the same shell. */
  let {
    label,
    expanded = false,
    element = $bindable<HTMLDivElement>(),
    class: className = '',
    onclose,
    children,
  }: {
    label: string;
    expanded?: boolean;
    element?: HTMLDivElement;
    class?: string;
    onclose: () => void;
    children: Snippet;
  } = $props();
  function escape(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape' ||
      document.fullscreenElement ||
      element !== [...document.querySelectorAll('[data-viewer-dialog]')].at(-1) ||
      element.querySelector('[role="menu"]')
    )
      return;
    event.stopPropagation();
    onclose();
  }
</script>

<svelte:window onkeydown={escape} />
<div class="viewer-backdrop" role="presentation" onclick={onclose}>
  <div
    bind:this={element}
    data-viewer-dialog
    class="viewer-dialog {className}"
    class:expanded
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={() => undefined}
  >
    {@render children()}
  </div>
</div>

<style>
  .viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sk-black-a55);
    backdrop-filter: blur(3px);
    animation: skFade 0.14s ease-out;
  }
  .viewer-dialog {
    width: min(920px, calc(100vw - 48px));
    height: min(640px, calc(100vh - 96px));
    display: flex;
    flex-direction: column;
    border-radius: var(--sk-radius-modal);
    background: var(--sk-modal);
    box-shadow:
      0 30px 80px var(--sk-black-a60),
      0 0 0 1px var(--sk-white-a4);
    animation: skIn 0.16s ease-out;
    overflow: hidden;
    outline: none;
    transition:
      width 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      height 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-radius 0.22s;
  }
  .viewer-dialog.expanded {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
    border-radius: 10px;
  }
  .viewer-dialog:fullscreen {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    box-shadow: none;
  }
</style>
