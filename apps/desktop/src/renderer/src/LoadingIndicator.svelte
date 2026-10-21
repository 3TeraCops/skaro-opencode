<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { t } from '@skaro/ui';
  let { size = 24 }: { size?: number } = $props();
</script>

<span class="loading-indicator" role="status" aria-label={t('agent.state.checking')}>
  <LoaderCircle {size} strokeWidth={1.8} />
</span>

<style>
  .loading-indicator {
    display: inline-flex;
    flex: none;
    color: var(--sk-text-21);
    animation: loading-spin 1s linear infinite;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loading-indicator {
      animation: none;
    }
  }
</style>
