<script lang="ts">
  import { prefersReducedMotion } from 'svelte/motion';
  import type { AgentActivity } from '@skaro/timeline';
  import { activityIcons } from './icons';
  import './activity-mark.css';

  let { kind, size }: { kind: AgentActivity; size?: number } = $props();
  let element: HTMLSpanElement | undefined = $state();
  const id = $props.id();
  const brain = $derived(kind === 'thinking' || kind === 'writing');
  const iconSize = $derived(size ?? (brain ? 18 : 16));
  const markup = $derived(
    activityIcons[kind]
      .replaceAll('hourglass-', `${id}-hourglass-`)
      .replaceAll('brain-', `${id}-brain-`),
  );

  $effect(() => {
    if (!brain && kind !== 'waiting_model') return;
    const svg = element?.querySelector('svg');
    if (!svg) return;
    if (prefersReducedMotion.current) {
      svg.setCurrentTime(brain ? 0 : 1.5);
      svg.pauseAnimations();
    } else {
      svg.unpauseAnimations();
    }
  });
</script>

<span
  bind:this={element}
  class="agent-activity activity-{kind}"
  data-activity={kind}
  style:width="{iconSize}px"
  style:height="{iconSize}px"
  aria-hidden="true"
>
  <!-- Only bundled owner-supplied SVG assets; no agent-provided markup. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html markup}
</span>
