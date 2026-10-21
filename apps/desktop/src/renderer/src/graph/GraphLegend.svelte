<script lang="ts">
  import { Toggle, t } from '@skaro/ui';
  import { groups, colors } from '../graph-preview/projection';
  let { motion = $bindable(true), flow = $bindable(true) }: { motion: boolean; flow: boolean } =
    $props();
</script>

<div class="graph-legend">
  {#each groups as group (group)}<span
      ><i style:background={colors[group]}></i>{t(`graph.${group}`)}</span
    >{/each}
  <div class="graph-toggles">
    <div><Toggle bind:checked={motion} label={t('graph.motion')} /></div>
    <div><Toggle bind:checked={flow} label={t('graph.flow')} /></div>
  </div>
</div>
