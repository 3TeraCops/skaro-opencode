<script lang="ts">
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import Markdown from './Markdown.svelte';
  let {
    itemId,
    path,
    divider = false,
  }: { itemId: string; path: string; divider?: boolean } = $props();
  const feed = useFeed();
  let text = $state<string>();
  let error = $state<string>();
  $effect(() => {
    let current = true;
    void feed.architectureFile?.(itemId, path, 'after').then(
      (value) => {
        if (current) text = value;
      },
      (reason: unknown) => {
        if (current) error = String(reason);
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if error}<div role="alert">{error}</div>
{:else if text !== undefined}<Markdown text={text + (divider ? '\n---\n' : '')} />
{:else}<span class="fd-pulse" aria-label={t('agent.state.checking')}></span>{/if}
