<script lang="ts">
  import type { CommandOutputView } from './command-output';
  import { useFeed } from './context.svelte';
  let { output, full, cursor }: { output: string; full: boolean; cursor: boolean } = $props();
  const feed = useFeed();
  let node = $state<HTMLDivElement>();
  let view = $state.raw<CommandOutputView>();
  $effect(() => {
    const root = node;
    if (!root) return;
    let disposed = false;
    let current: CommandOutputView | undefined;
    void import('./command-output')
      .then(({ createCommandOutput }) => {
        if (disposed) return;
        current = createCommandOutput(root, (error) => feed.historyError?.(error));
        view = current;
      })
      .catch((error: unknown) => {
        if (!disposed) feed.historyError?.(String(error));
      });
    return () => {
      disposed = true;
      current?.destroy();
    };
  });
  $effect(() => view?.update({ output, full, cursor }));
</script>

<div>
  <div bind:this={node}></div>
  {#if !view}<div class="fd-output" class:full><span class="fd-pulse"></span></div>{/if}
</div>
