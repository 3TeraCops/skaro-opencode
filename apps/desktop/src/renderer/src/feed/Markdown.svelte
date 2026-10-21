<script lang="ts">
  import { useFeed } from './context.svelte';
  import { drawMermaid } from './markdown';
  import { agentMarkdown } from './markdown-work';
  import { mountC4 } from '../c4/markdown';
  import { MarkdownDom } from './markdown-dom';
  import { markdownInteractions } from './markdown-interactions';
  import LoadingIndicator from '../LoadingIndicator.svelte';

  let { text }: { text: string } = $props();
  const interactions = markdownInteractions(useFeed());
  let root = $state<HTMLDivElement>();
  let parts = $state.raw<string[]>([]);
  let renderer = $state.raw<MarkdownDom>();
  let painted = $state(false);

  $effect(() => {
    const request = agentMarkdown(text);
    let current = true;
    void request.result
      .then((value) => {
        if (current) parts = value;
      })
      .catch((error) => console.error('Agent Markdown:', error));
    return () => {
      current = false;
      request.cancel();
    };
  });
  $effect(() => {
    if (!root) return;
    const dom = new MarkdownDom(
      root,
      (fragment) => {
        void drawMermaid(fragment);
        void interactions.decorate(fragment);
        return mountC4(fragment);
      },
      () => {
        painted = true;
      },
    );
    renderer = dom;
    return () => dom.destroy();
  });
  $effect(() => {
    const dom = renderer;
    if (!dom) return;
    if (!parts.length) painted = false;
    void dom.update(parts).catch((error) => console.error('Agent Markdown DOM:', error));
    return () => dom.cancel();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" bind:this={root} onclick={interactions.onclick}>
  {#if !painted && text}<LoadingIndicator size={16} />{/if}
</div>

<style>
  .md :global(.md-remote-label) {
    flex: 1;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }
</style>
