<script lang="ts">
  import LoadingIndicator from '../LoadingIndicator.svelte';
  let { overlay = false }: { overlay?: boolean } = $props();
</script>

<div class="loading" class:overlay>
  <LoadingIndicator />
</div>

<style>
  .loading {
    flex: 1;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
  }
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: var(--sk-bg);
  }
</style>
