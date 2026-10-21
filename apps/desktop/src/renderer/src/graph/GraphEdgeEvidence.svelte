<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import type { GraphEdge, SourceRef } from '@skaro/core/graph-view';
  let { edge, onsource }: { edge: GraphEdge; onsource: (ref: SourceRef) => void } = $props();
</script>

<h4>{t('graph.sources')}</h4>
{#each edge.evidence as evidence, index (index)}
  <p>{evidence.explanation}</p>
  <code>{evidence.rule} · {t(`graph.resolution.${edge.resolution}`)}</code>
  <Button variant="ghost" size="sm" onclick={() => onsource(evidence.sourceRef)}
    ><code>{evidence.sourceRef.path}:{evidence.sourceRef.line ?? 1}</code></Button
  >
{/each}
