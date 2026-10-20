<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import Markdown from './Markdown.svelte';
  import ArchitectureFile from './ArchitectureFile.svelte';
  import VirtualBlocks from './VirtualBlocks.svelte';
  let { state: model }: { state: ProposalState } = $props();
  let text = $state<string>();
  let error = $state<string>();
  let files = $state<{ id: string }[]>();
  async function copyAll(): Promise<void> {
    const proposal = model.proposal;
    if (proposal.type !== 'architecture' || !proposal.contentRef) return;
    try {
      const value = await model.feed.architectureContent?.(proposal.contentRef, 'after');
      if (value !== undefined) await navigator.clipboard.writeText(value);
    } catch (reason) {
      error = String(reason);
    }
  }
  $effect(() => {
    const proposal = model.proposal;
    if (proposal.type !== 'architecture' || !proposal.contentRef) {
      if ('after' in proposal) text = proposal.after;
      return;
    }
    if (model.feed.architectureFiles) {
      let current = true;
      void model.feed.architectureFiles(proposal.contentRef).then(
        (paths) => {
          if (current) files = paths.map((id) => ({ id }));
        },
        (reason: unknown) => {
          if (current) error = String(reason);
        },
      );
      return () => {
        current = false;
      };
    }
    let current = true;
    void model.feed.architectureContent?.(proposal.contentRef, 'after').then(
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
{:else if files && model.proposal.type === 'architecture' && model.proposal.contentRef}
  {@const itemId = model.proposal.contentRef}
  <VirtualBlocks blocks={files} gap={0} estimate={1600} threshold={3} {copyAll}>
    {#snippet children(file)}<ArchitectureFile
        {itemId}
        path={file.id}
        divider={file.id !== files?.at(-1)?.id}
      />{/snippet}
  </VirtualBlocks>
{:else if text !== undefined}<Markdown {text} />
{:else}<span class="fd-pulse" aria-label={t('agent.state.checking')}></span>{/if}
