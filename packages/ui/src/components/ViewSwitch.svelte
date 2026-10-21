<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';
  let {
    value,
    options,
    onchange,
  }: {
    value: string;
    options: { id: string; label: string; icon: IconName }[];
    onchange: (id: string) => void;
  } = $props();
</script>

<div class="seg">
  {#each options as option (option.id)}
    <button
      type="button"
      class:active={value === option.id}
      aria-pressed={value === option.id}
      onclick={() => onchange(option.id)}
    >
      <Icon name={option.icon} size={13} stroke={2} />{option.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--sk-deep);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-17);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  button.active {
    background: var(--sk-bg);
    color: var(--sk-text-2);
    box-shadow: 0 1px 2px var(--sk-black-a35);
  }
</style>
