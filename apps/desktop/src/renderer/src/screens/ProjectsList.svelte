<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectsBoardState } from './projects-board.svelte';
  import ProjectListRow from './ProjectListRow.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  let { state, onopen }: { state: ProjectsBoardState; onopen: (id: string) => void } = $props();
</script>

<div class="table">
  <div class="row head-row">
    <div>{t('projects.col.project')}</div>
    <div>{t('projects.col.milestone')}</div>
    <div>{t('projects.col.statuses')}</div>
    <div>{t('projects.col.agent')}</div>
    <div></div>
  </div>
  <WindowedContent
    count={state.source.count}
    revision={state.source.revision}
    read={(start) => state.listRows(start)}
    gap={0}
    estimate={64}
  >
    {#snippet children(row)}<ProjectListRow c={row.card} {onopen} />{/snippet}
  </WindowedContent>
</div>
