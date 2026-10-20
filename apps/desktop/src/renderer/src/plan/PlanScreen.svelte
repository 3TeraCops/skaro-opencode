<script lang="ts">
  import { Banner } from '@skaro/ui';
  import LoadingView from '../screens/LoadingView.svelte';
  import type { PlanProps } from './plan-props';
  import { createPlanController } from './plan-controller.svelte';
  import DeleteStage from './DeleteStage.svelte';
  import PlanHeader from './PlanHeader.svelte';
  import PlanEmpty from './PlanEmpty.svelte';
  import PlanStages from './PlanStages.svelte';
  import './i18n';
  import './plan-screen.css';
  let p: PlanProps = $props();
  const model = createPlanController(() => p);
</script>

<div data-plan-screen class="screen">
  <PlanHeader {model} />
  {#if model.error}
    <div data-plan-screen class="refused">
      <Banner kind="error" text={model.error} onclose={() => (model.error = undefined)} />
    </div>
  {/if}

  {#if !model.loaded}
    <LoadingView />
  {:else if !model.list.length}
    <PlanEmpty {model} />
  {:else}
    <PlanStages {model} />
  {/if}
</div>

{#if model.modal?.kind === 'delete'}
  {@const m = model.modal.milestone}
  <DeleteStage
    milestone={m}
    tasks={model.taskCount(m.id)}
    onconfirm={() => void model.remove(m)}
    onclose={() => (model.modal = undefined)}
  />
{/if}
