<script lang="ts">
  import { Popover, Button, IconButton, Icon, t } from '@skaro/ui';
  import type { ProjectGraph } from './data.svelte';
  let { model }: { model: ProjectGraph } = $props();
</script>

<footer class="graph-footer">
  <span
    >{t('graph.count', {
      nodes: model.page?.nodes.length ?? 0,
      edges: model.page?.edges.length ?? 0,
    })}
    {#if model.page?.aggregated}
      · {t('graph.aggregated', { n: model.page.aggregated })}{/if}
    {#if model.page?.omitted}
      · {t('graph.omitted', { n: model.page.omitted })}{/if}</span
  >
  {#if model.page?.hasMore}<Button
      variant="ghost"
      size="sm"
      disabled={(model.page?.nodes.length ?? 0) >= 5000}
      onclick={() => {
        void model.more();
      }}>{t('graph.loadMore')}</Button
    >{/if}
  <Popover align="right" width={420} maxHeight={400}>
    {#snippet trigger({ toggle })}<Button size="sm" variant="ghost" onclick={toggle}
        >{t('graph.coverage')}</Button
      >{/snippet}
    <div class="graph-coverage">
      <p>
        {t('graph.coverageCounts', {
          parsed: model.snapshot?.coverage.parsed ?? 0,
          found: model.snapshot?.coverage.found ?? 0,
          skipped: model.snapshot?.coverage.skipped ?? 0,
          errors: model.snapshot?.coverage.errors ?? 0,
          unresolved: model.snapshot?.coverage.unresolved ?? 0,
        })}
      </p>
      {#each model.snapshot?.coverage.limitations ?? [] as text (text)}<p>{text}</p>{/each}
      {#each (model.snapshot?.coverage.diagnostics ?? []).slice(0, 30) as diagnostic, index (index)}<p
        >
          <code>{diagnostic.path}</code> · {diagnostic.message}
        </p>{/each}
    </div>
  </Popover>
  <IconButton
    tip={t('graph.rebuild')}
    onclick={() => {
      void window.skaro
        .invoke('graph.rebuild', model.projectId)
        .catch((error) => (model.error = String(error)));
    }}><Icon name="reset" size={14} /></IconButton
  >
  <span>{t('graph.animationDisclaimer')}</span>
</footer>
