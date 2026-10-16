<script lang="ts">
  import { Banner, t } from '@skaro/ui';
  import type { TaskView } from '../../../shared/ipc';
  import './environment-review-i18n';

  let {
    state,
    onfinish,
  }: {
    state: TaskView['environmentReview'];
    onfinish: () => void;
  } = $props();
</script>

{#if state}
  <Banner
    kind="info"
    text={t(`task.environmentReview.${state}`)}
    action={t('task.environmentReview.finish')}
    onaction={onfinish}
  />
{/if}
