<script lang="ts">
  import { t } from '@skaro/ui';
</script>

<div class="loading" role="status" aria-label={t('agent.state.checking')}>
  <span class="fd-pulse"></span>
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
