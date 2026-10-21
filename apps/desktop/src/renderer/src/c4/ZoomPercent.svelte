<script lang="ts">
  import { t } from '@skaro/ui';
  let {
    zoom,
    onzoom,
    min = 0.02,
    max = 4,
  }: {
    zoom: number;
    onzoom: (factor: number) => void;
    min?: number;
    max?: number;
  } = $props();
  let editing = $state(false),
    text = $state('');
  let element: HTMLSpanElement;
  $effect(() => {
    if (!editing) text = `${Math.round(zoom * 100)}%`;
  });
  function commit(): void {
    const candidate = text.trim().replace(/%$/, '').trim().replace(',', '.');
    const value = /^\d+(?:\.\d+)?$/.test(candidate) ? Number(candidate) / 100 : NaN;
    if (Number.isFinite(value) && value > 0) onzoom(Math.min(max, Math.max(min, value)) / zoom);
    text = `${Math.round(zoom * 100)}%`;
    editing = false;
  }
  function keys(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      element.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      text = `${Math.round(zoom * 100)}%`;
      editing = false;
      element.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const value = Math.min(max, Math.max(min, zoom + (event.key === 'ArrowUp' ? 0.1 : -0.1)));
      onzoom(value / zoom);
      text = `${Math.round(value * 100)}%`;
    }
  }
</script>

<span
  bind:this={element}
  contenteditable="plaintext-only"
  role="spinbutton"
  tabindex="0"
  aria-label={t('c4.zoom')}
  aria-valuenow={Math.round(zoom * 100)}
  aria-valuemin={min * 100}
  aria-valuemax={max * 100}
  inputmode="decimal"
  spellcheck="false"
  bind:textContent={text}
  onfocus={() => {
    editing = true;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }}
  onblur={commit}
  onkeydown={keys}
></span>

<style>
  span {
    display: inline-block;
    min-width: 42px;
    text-align: center;
    font: var(--sk-fs-3) var(--sk-mono);
    color: var(--sk-text-muted);
    cursor: text;
    outline: none;
    white-space: nowrap;
  }
</style>
