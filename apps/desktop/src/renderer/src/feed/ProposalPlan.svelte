<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  let { state }: { state: ProposalState } = $props();
  const plan = $derived(state.plan);
</script>

{#if plan}
  <div class="card flush">
    <div class="head plan-head">
      <Icon name="package" size={14} stroke={1.9} color="var(--sk-accent)" />
      <span class="title">{state.planTitle()}</span>
    </div>
    {#if plan.tasks.length}
      <div class="tasks">
        {#each plan.tasks as task (task.ref)}
          {@const on = state.selected(task.ref)}
          <button
            type="button"
            class="task"
            class:static={!state.actionable || state.accepted}
            role="checkbox"
            aria-checked={on}
            aria-disabled={state.accepted || state.created.has(task.ref)}
            data-tip={plan.complete ? t('proposal.plan.selectionHint') : undefined}
            onclick={() => state.toggle(task.ref)}
          >
            <span class="box" class:on>
              {#if on}<Icon name="check" size={11} stroke={3.2} color="var(--sk-text-3)" />{/if}
            </span>
            <span class="task-texts">
              <span class="task-title" class:on>{task.title}</span>
              {#if task.milestone}<span class="task-meta"
                  >{task.milestone.id} · {task.milestone.title}</span
                >{/if}
              <span class="task-meta">{state.meta(task)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
    {#if state.accepted}
      <div class="foot plan-foot"><span class="hint">{state.progressText}</span></div>
    {:else if state.actionable}
      <div class="foot plan-foot">
        <span class="hint"
          >{state.milestoneOnly
            ? ''
            : state.chosen.length === 0
              ? t('proposal.plan.hint.none')
              : plan.complete
                ? t('proposal.plan.confirmHint', {
                    tasks: tn('proposal.tasks', state.chosen.length),
                  })
                : plan.milestone
                  ? t('proposal.plan.hint', { id: plan.milestone.id })
                  : t('proposal.plan.hint.loose')}</span
        >
        <button
          type="button"
          class="btn"
          disabled={state.busy}
          onclick={() => void state.decide({ action: 'reject' })}
          ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
        >
        <button
          type="button"
          class="btn primary"
          disabled={state.busy ||
            (!state.accepted && !state.milestoneOnly && state.chosen.length === 0)}
          onclick={() =>
            void state.decide({ action: 'apply', tasks: state.chosen.map((c) => c.ref) })}
          ><Icon
            name={state.milestoneOnly ? 'check' : 'plus'}
            size={13}
            stroke={2.4}
          />{plan.complete
            ? t('proposal.plan.confirm')
            : state.milestoneOnly
              ? t('proposal.accept')
              : state.chosen.length === 0
                ? t('proposal.plan.pick')
                : state.chosen.length === plan.tasks.length
                  ? t('proposal.plan.create', { tasks: tn('proposal.tasks', state.chosen.length) })
                  : t('proposal.plan.createSome', { n: state.chosen.length })}</button
        >
      </div>
    {/if}
  </div>
{/if}
