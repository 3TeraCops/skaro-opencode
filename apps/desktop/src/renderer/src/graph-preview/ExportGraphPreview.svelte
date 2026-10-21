<script lang="ts">
  import GraphPreview from './GraphPreview.svelte';
  import C4Workspace from '../c4/C4Workspace.svelte';
  import type { C4Model } from '@skaro/core/c4-view';
  import { TooltipHost } from '@skaro/ui';
  import '../c4/i18n';
  let { model }: { model: C4Model } = $props();
  let c4 = $state(false);
  export function openC4(): void {
    c4 = true;
  }
  export function closeC4(): void {
    c4 = false;
  }
</script>

<TooltipHost />
{#if c4}<C4Workspace
    {model}
    projectId="chatballs-export"
    onclose={() => (c4 = false)}
    ongraph={() => (c4 = false)}
  />
{:else}<GraphPreview {model} />{/if}
