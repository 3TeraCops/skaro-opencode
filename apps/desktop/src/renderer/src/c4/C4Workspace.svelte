<script lang="ts">
  import { onMount } from 'svelte';
  import type { C4Model } from '@skaro/core/c4-view';
  import { createC4Viewer } from './viewer-state.svelte';
  import C4Scene from './C4Scene.svelte';
  import './viewer.css';
  let {
    model,
    projectId,
    target,
    onclose,
    ongraph,
  }: {
    model: C4Model;
    projectId: string;
    target?: { viewId: string; elementId?: string } | undefined;
    onclose: () => void;
    ongraph: (id: string, viewId: string) => void;
  } = $props();
  const key = `skaro.c4.navigation.${(() => projectId)()}`;
  let saved: { viewId?: string; selected?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    /* Invalid local presentation is discarded. */
  }
  // svelte-ignore state_referenced_locally
  const initial = target?.viewId ?? saved.viewId;
  // svelte-ignore state_referenced_locally
  const initialView =
    model.views.find((view) => view.id === initial)?.id ??
    model.views.find((view) => view.state === 'current' && view.kind === 'context')?.id ??
    model.views[0]!.id;
  const viewer = createC4Viewer(
    () => model,
    initialView,
    () => onclose(),
  );
  let element = $state<HTMLDivElement>();
  onMount(() => {
    if (element) viewer.attach(element);
    viewer.selected = target?.elementId ?? saved.selected ?? '';
  });
  $effect(() => {
    localStorage.setItem(
      key,
      JSON.stringify({ viewId: viewer.view.id, selected: viewer.selected }),
    );
  });
  $effect(() => {
    if (target) {
      viewer.go(target.viewId);
      viewer.selected = target.elementId ?? '';
    }
  });
</script>

<svelte:document onfullscreenchange={viewer.fullscreenChanged} />
<C4Scene {viewer} bind:element {ongraph} />
