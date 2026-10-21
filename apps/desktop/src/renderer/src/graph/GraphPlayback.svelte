<script lang="ts">
  import { IconButton, Select, t } from '@skaro/ui';
  import { RotateCcw, SkipBack, SkipForward, Play, Pause } from '@lucide/svelte';
  import type { ScenarioPlayback } from './playback.svelte';
  let { player, onchanged }: { player: ScenarioPlayback; onchanged: () => void } = $props();
  const disabled = $derived(['error', 'invalidated'].includes(player.phase));
  const options = $derived(
    player.scenario?.steps.map((step, index) => ({
      value: String(index),
      label: /^\s*\d+[.)]\s/.test(step.description)
        ? step.description
        : `${step.ordinal}. ${step.description}`,
    })) ?? [],
  );
</script>

{#if player.scenario}
  <nav class="c4-viewer-nav graph-playback" aria-label={t('graph.playback')}>
    <IconButton
      tip={t('graph.restart')}
      {disabled}
      onclick={() => {
        player.choose(0);
        onchanged();
      }}><RotateCcw size={15} /></IconButton
    >
    <IconButton
      tip={t('graph.previous')}
      disabled={disabled || player.index === 0}
      onclick={() => {
        player.choose(player.index - 1);
        onchanged();
      }}><SkipBack size={15} /></IconButton
    >
    <IconButton
      tip={t(player.phase === 'playing' ? 'graph.pauseScenario' : 'graph.play')}
      {disabled}
      onclick={() => {
        if (player.phase === 'playing') player.pause();
        else player.play();
        onchanged();
      }}
    >
      {#if player.phase === 'playing'}<Pause size={16} />{:else}<Play size={16} />{/if}
    </IconButton>
    <IconButton
      tip={t('graph.next')}
      disabled={disabled || player.index === player.scenario.steps.length - 1}
      onclick={() => {
        player.choose(player.index + 1);
        onchanged();
      }}><SkipForward size={15} /></IconButton
    >
    <div class="c4-viewer-select">
      <Select
        {options}
        label={t('graph.chooseStep')}
        width="100%"
        {disabled}
        bind:value={
          () => String(player.index),
          (value) => {
            player.choose(Number(value));
            onchanged();
          }
        }
      />
    </div>
    <Select
      label={t('graph.speed')}
      options={[
        { value: '0.5', label: '0.5×' },
        { value: '1', label: '1×' },
        { value: '2', label: '2×' },
      ]}
      bind:value={
        () => String(player.speed),
        (value) => {
          player.speed = Number(value);
          onchanged();
        }
      }
      width={82}
    />
  </nav>
  <div class="graph-step" aria-live="polite">
    <span
      >{t(`c4.${player.scenario.state}`)} · {t('graph.step', {
        n: player.index + 1,
        total: player.scenario.steps.length,
      })}</span
    >
    <p>{player.step?.description}</p>
    {#if player.step?.technology}<span>{player.step.technology}</span>{/if}
  </div>
{/if}
