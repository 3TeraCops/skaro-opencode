<script lang="ts">
  import { t } from '@skaro/ui';
  import ActivityMark from '../activity/ActivityMark.svelte';
</script>

<div class="task-starting" role="status">
  <ActivityMark kind="thinking" size={96} />
  <span>{t('task.starting')}</span>
</div>

<style>
  .task-starting {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 2px;
    font-size: var(--sk-fs-5);
    line-height: 1.5;
    color: var(--sk-text-21);
    text-align: center;
  }
</style>
