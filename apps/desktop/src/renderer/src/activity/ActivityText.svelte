<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<span class="activity-text">{@render children()}</span>

<style>
  .activity-text {
    color: var(--sk-text-23);
    background: linear-gradient(
      110deg,
      var(--sk-text-23) 42%,
      var(--sk-text-3) 50%,
      var(--sk-text-23) 58%
    );
    background-size: 250% 100%;
    background-position: 150% 0;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: sk-activity-shine 3.6s ease-in-out infinite;
  }

  @keyframes sk-activity-shine {
    0% {
      background-position: 150% 0;
    }
    45%,
    100% {
      background-position: -150% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .activity-text {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
    }
  }
</style>
