<script lang="ts">
  import { untrack } from 'svelte';
  import type { InlineTextView } from './inline-diff-contract';
  let { text, create }: { text: string; create?: InlineTextView } = $props();
  let node = $state<HTMLDivElement>();
  // A page's object can be invalidated by selection without changing its text or factory.
  const value = $derived(text);
  const renderer = $derived(create);
  $effect(() => {
    const root = node,
      build = renderer,
      content = value;
    // The imperative renderer must not subscribe this lifetime to reads made during construction.
    if (root && build) return untrack(() => build(root, content).destroy);
  });
</script>

{#if create}
  <div class="diff-text" bind:this={node}></div>
{:else}<span>{text}</span>{/if}

<style>
  .diff-text {
    flex: 1;
    min-width: 0;
    min-height: 1.5em;
  }
</style>
