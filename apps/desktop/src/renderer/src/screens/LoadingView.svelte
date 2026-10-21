<script lang="ts">
  import LoadingIndicator from '../LoadingIndicator.svelte';
</script>

<div class="loading">
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
</style>
