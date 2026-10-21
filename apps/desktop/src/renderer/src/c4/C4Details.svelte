<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import './details.css';
  import type { C4Model } from '@skaro/core/c4-view';
  import { kindKey } from './i18n';
  let {
    model,
    selected,
    onselect,
    ondrill,
    planned = false,
    canDrill = false,
    children,
    onsource,
  }: {
    model: C4Model;
    selected: string;
    onselect: (id: string) => void;
    ondrill: (id: string) => void;
    planned?: boolean;
    canDrill?: boolean;
    children?: Snippet | undefined;
    onsource?: ((path: string) => void) | undefined;
  } = $props();
  const element = $derived(model.elements.find((e) => e.id === selected));
  const relationship = $derived(model.relationships.find((r) => r.id === selected));
  const entity = $derived(element ?? relationship);
  const relationships = $derived(
    model.relationships.filter((r) => r.source === selected || r.target === selected),
  );
  const requirements = $derived(
    model.specifications.flatMap((s) =>
      s.requirements
        .filter((r) => r.elements.includes(selected) || r.relationships.includes(selected))
        .map((r) => `SPEC-${s.id} / ${r.id} · ${s.description}`),
    ),
  );
</script>

{#if entity}
  <aside class="c4-details" aria-label={t('c4.details')}>
    <span class="kind">{element ? t(kindKey(element.kind)) : t('c4.relationships')}</span>
    <h3>{element?.name ?? relationship?.description}</h3>
    <code>{entity.id}</code>
    <span class="state">{t(`c4.${planned ? 'planned' : entity.state}`)}</span>
    <p>{entity.description}</p>
    {#if entity.technology}<h4>{t('c4.technology')}</h4>
      <p>{entity.technology}</p>{/if}
    {#if element && canDrill}
      <Button variant="ghost" size="sm" onclick={() => ondrill(element.id)}>{t('c4.drill')}</Button>
    {/if}
    {#if element?.code.length}<h4>{t('c4.code')}</h4>
      {#each element.code as path, i (i)}{#if onsource}<Button
            variant="ghost"
            size="sm"
            onclick={() => onsource?.(path)}><code>{path}</code></Button
          >{:else}<code>{path}</code>{/if}{/each}{/if}
    {#if relationship}
      {#each [relationship.source, relationship.target] as id (id)}<Button
          variant="ghost"
          size="sm"
          onclick={() => onselect(id)}>{model.elements.find((e) => e.id === id)?.name}</Button
        >{/each}
    {/if}
    {#if relationships.length}<h4>{t('c4.relationships')}</h4>
      {#each relationships as r (r.id)}<div class="relation">
          <Button variant="ghost" size="sm" onclick={() => onselect(r.id)}
            ><span data-tip={r.description}>{r.description}</span></Button
          ><small
            >{model.elements.find((e) => e.id === (r.source === selected ? r.target : r.source))
              ?.name}</small
          >
        </div>{/each}{/if}
    {#if requirements.length}<h4>{t('c4.requirements')}</h4>
      {#each requirements as requirement, i (i)}<p>{requirement}</p>{/each}{/if}
    {#if entity.decisions.length}<h4>{t('c4.decisions')}</h4>
      {#each entity.decisions as id, i (i)}<code>ADR-{id}</code>{/each}{/if}
    <h4>{t('c4.evidence')}</h4>
    {#each entity.evidence as text, i (i)}<p>{text}</p>{/each}
    {@render children?.()}
  </aside>
{/if}
