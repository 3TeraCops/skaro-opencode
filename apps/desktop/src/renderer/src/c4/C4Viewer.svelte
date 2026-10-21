<script lang="ts">
  import { onMount } from 'svelte';
  import { ViewerModal } from '@skaro/ui';
  import type { C4Model } from '@skaro/core/c4-view';
  import C4Scene from './C4Scene.svelte';
  import { createC4Viewer } from './viewer-state.svelte';
  import './viewer.css';
  import './i18n';
  let {
    model,
    initialView,
    onclose,
  }: { model: C4Model; initialView: string; onclose: () => void } = $props();
  let dialog = $state<HTMLDivElement>();
  // svelte-ignore state_referenced_locally
  const viewer = createC4Viewer(() => model, initialView, onclose);
  onMount(() => viewer.attach(dialog!));
</script>

<svelte:document onfullscreenchange={viewer.fullscreenChanged} />
<ViewerModal
  class="c4-viewer-dialog"
  bind:element={dialog}
  label={viewer.view.title}
  expanded
  onclose={() => void viewer.close()}
>
  <C4Scene {viewer} />
</ViewerModal>
