<script lang="ts">
  import { Button, Select, Banner, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  let { model, id, name }: { model: ProjectGraph; id: string; name: string } = $props();
  const analysis = $derived(model.analysis);
</script>

<h4>{t('graph.path')}</h4>
<div class="graph-actions">
  <Button
    variant="ghost"
    size="sm"
    onclick={() => {
      analysis.from = id;
      analysis.fromName = name;
    }}>{t('graph.pathFrom')}</Button
  >
  <Button
    variant="ghost"
    size="sm"
    onclick={() => {
      analysis.target = id;
      analysis.targetName = name;
    }}>{t('graph.pathTo')}</Button
  >
</div>
{#if analysis.from}<p>{analysis.fromName} → {analysis.targetName || '…'}</p>{/if}
<Select
  label={t('graph.direction')}
  width="100%"
  menuWidth="100%"
  options={[
    { value: 'out', label: t('graph.directed') },
    { value: 'both', label: t('graph.undirected') },
  ]}
  bind:value={analysis.direction}
/>
<Select
  label={t('graph.depth')}
  width="100%"
  menuWidth="100%"
  options={[1, 2, 3, 5, 8, 12, 24, 64].map((depth) => ({
    value: String(depth),
    label: t('graph.depthValue', { n: depth }),
  }))}
  bind:value={() => String(analysis.depth), (value) => (analysis.depth = Number(value))}
/>
<Button
  size="sm"
  disabled={!analysis.from || !analysis.target || analysis.busy}
  onclick={() => {
    void analysis.path();
  }}>{t('graph.findPath')}</Button
>
<Button
  variant="ghost"
  size="sm"
  disabled={analysis.busy}
  onclick={() => {
    void analysis.impact(id);
  }}>{t('graph.impact')}</Button
>
<p>{t('graph.pathEvidence')}</p>
{#if analysis.result}
  <Banner
    kind="info"
    text={analysis.result.incomplete
      ? t('graph.searchLimited')
      : analysis.result.path && !analysis.result.path.length && analysis.result.reason === 'no-path'
        ? t('graph.noPath')
        : t('graph.analysisResult', { n: analysis.result.nodes.length })}
  />
  <Button variant="ghost" size="sm" onclick={() => analysis.clear()}
    >{t('graph.clearAnalysis')}</Button
  >
{/if}
