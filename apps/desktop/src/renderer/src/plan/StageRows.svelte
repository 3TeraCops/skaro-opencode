<script lang="ts">
  import { t } from '@skaro/ui';
  import WindowedContent from '../WindowedContent.svelte';
  import TaskRow from './TaskRow.svelte';
  import type { StageController } from './stage-controller.svelte';
  import { createPlanRows } from './plan-rows.svelte';
  let { model }: { model: StageController } = $props();
  const rows = createPlanRows(() => model);
  export const reveal = (index: number) => rows.reveal(index);
  export const revealTask = (id: string) => rows.revealTask(id);
</script>

<div data-plan-stage class="rows" role="list" data-rows>
  <WindowedContent
    bind:this={rows.content}
    count={rows.count}
    revision={rows.revision}
    identity={rows.range.identity}
    read={rows.read}
    scroller=".stages[data-plan-screen]"
    gap={2}
    estimate={38}
  >
    {#snippet children(entry)}
      {#if entry.task}
        {@const task = entry.task}
        <div data-plan-index={entry.index}>
          <TaskRow
            {task}
            dependencies={entry.dependencies}
            now={model.p.now}
            archived={model.p.archived}
            relation={model.relation(task)}
            faded={!!model.p.hovered &&
              model.p.hovered !== task.id &&
              !model.p.up.has(task.id) &&
              !model.p.down.has(task.id)}
            dropped={model.p.dropped === task.id}
            onenter={() => !model.p.drag && model.p.onhover(task.id)}
            onleave={() => model.p.onhover(undefined)}
            onopen={() => model.p.onopen(task.id)}
            onrestore={() => model.p.onrestore?.(task.id)}
            ondown={model.p.archived
              ? undefined
              : (event) => {
                  model.p.onhover(undefined);
                  model.p.ondown('task', task.id, model.m.id, event, task, entry.dependencies);
                }}
            onkey={model.p.archived
              ? undefined
              : (event) =>
                  model.p.onkey('task', task.id, model.m.id, event, task, entry.dependencies)}
          />
        </div>
      {:else}
        <div data-plan-stage class="slot" style="height: {model.slot?.h || 38}px">
          <span></span>
        </div>
      {/if}
    {/snippet}
  </WindowedContent>
  {#if !rows.count}<div data-plan-stage class="empty">{t('plan.empty.stage')}</div>{/if}
</div>
