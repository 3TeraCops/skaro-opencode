<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A custom dropdown container: opens under its trigger, closes on outside click and Esc. The menu
   * is placed against the window, so a scrolling parent (a modal body) never clips it.
   */
  let {
    open = $bindable(false),
    width,
    align = 'left',
    offset = 34,
    maxHeight,
    trigger,
    children,
  }: {
    open?: boolean;
    width?: number | string;
    align?: 'left' | 'right';
    offset?: number;
    /** Longer menus scroll inside this height. */
    maxHeight?: number;
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    children: Snippet<[{ close: () => void }]>;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();
  let place = $state<{ top: number; left: number; width: number; height: number } | undefined>();

  const toggle = () => (open = !open);
  const close = () => (open = false);

  function measure(): void {
    const rect = root?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    const below = Math.max(0, window.innerHeight - rect.top - offset - gap);
    const above = Math.max(0, rect.top - gap - 4);
    const desired = Math.min(maxHeight ?? window.innerHeight - gap * 2, menu?.scrollHeight ?? 0);
    const upwards = desired > below && above > below;
    const height = Math.min(maxHeight ?? window.innerHeight - gap * 2, upwards ? above : below);
    const actualWidth = Math.min(menu?.offsetWidth ?? rect.width, window.innerWidth - gap * 2);
    const next = {
      top: upwards ? Math.max(gap, rect.top - Math.min(desired, height) - 4) : rect.top + offset,
      left: Math.max(
        gap,
        Math.min(
          align === 'left' ? rect.left : rect.right - actualWidth,
          window.innerWidth - actualWidth - gap,
        ),
      ),
      width: rect.width,
      height,
    };
    if (
      place?.top !== next.top ||
      place.left !== next.left ||
      place.width !== next.width ||
      place.height !== next.height
    )
      place = next;
  }

  $effect(() => {
    if (!open) return;
    // The trigger moves with scrolling parents and opening animations; the menu follows it.
    let frame = 0;
    const follow = () => {
      measure();
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  });

  const menuWidth = $derived(
    width === '100%' && place
      ? `${place.width}px`
      : width === undefined
        ? undefined
        : typeof width === 'number'
          ? `${width}px`
          : width,
  );

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
    };
  });
</script>

<div class="anchor" bind:this={root}>
  {@render trigger({ toggle, open })}
  {#if open && place}
    <div
      class="menu"
      bind:this={menu}
      role="menu"
      style="top: {place.top}px; left: {place.left}px; {menuWidth
        ? `width: ${menuWidth};`
        : ''} max-height: {place.height}px;"
    >
      {@render children({ close })}
    </div>
  {/if}
</div>

<style>
  .anchor {
    position: relative;
  }

  .menu {
    position: fixed;
    max-width: calc(100vw - 16px);
    overflow-y: auto;
    overscroll-behavior: contain;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-menu);
    box-shadow: var(--sk-menu-shadow);
    animation: skIn 0.14s ease-out;
  }
</style>
