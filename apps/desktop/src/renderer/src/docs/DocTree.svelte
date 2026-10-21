<script lang="ts">
  import type { TreeProps } from './tree-props';
  import { createTreeController } from './tree-controller.svelte';
  let {
    docs,
    width = $bindable(),
    onselect,
    onhide,
    onnew,
    onnewspec,
    onimport,
  }: TreeProps = $props();
  const model = createTreeController({
    get docs() {
      return docs;
    },
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
    },
    get onselect() {
      return onselect;
    },
    get onhide() {
      return onhide;
    },
    get onnew() {
      return onnew;
    },
    get onnewspec() {
      return onnewspec;
    },
    get onimport() {
      return onimport;
    },
  });
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import { recordOf, titleOf } from './model';
  import DocTreeFooter from './DocTreeFooter.svelte';
  import DocTreeItem from './DocTreeItem.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  import './doc-tree.css';
</script>

{#snippet item(doc: DocEntry, icon: 'brief' | 'arch' | 'doc' | undefined, known = false)}
  {@const on = model.p.docs.selected === doc.path}
  {@const missing = !known && !model.p.docs.exists(doc.path)}
  {@const rec = recordOf(doc)}
  <DocTreeItem
    title={titleOf(doc)}
    selected={on}
    muted={missing || rec?.status === 'superseded'}
    tip={model.tip(doc, missing)}
    number={rec?.id}
    proposed={rec?.status === 'proposed'}
    icon={icon
      ? icon === 'brief'
        ? 'docText'
        : icon === 'arch'
          ? 'layers'
          : 'fileBlank'
      : undefined}
    onselect={() => model.p.onselect(doc.path)}
  />
{/snippet}

{#snippet group(key: 'adr' | 'specs' | 'docs', count: number)}
  <div
    data-doc-tree
    class="group"
    role="button"
    tabindex="0"
    onclick={() => (model.groups = { ...model.groups, [key]: !model.groups[key] })}
    onkeydown={(e) =>
      e.key === 'Enter' && (model.groups = { ...model.groups, [key]: !model.groups[key] })}
  >
    <span data-doc-tree class="chev" class:open={model.groups[key]}
      ><Icon name="chevronRight" size={12} stroke={2.4} /></span
    >
    <span data-doc-tree class="group-label">{t(`docs.group.${key}`)}</span>
    <span data-doc-tree class="count">{count}</span>
  </div>
{/snippet}

<div data-doc-tree class="tree" style="width: {model.p.width}px">
  <div data-doc-tree class="head">
    <span data-doc-tree class="title">{t('docs.title')}</span>
    <button
      data-doc-tree
      type="button"
      class="hide"
      data-tip={t('docs.tree.hide')}
      onclick={model.p.onhide}><Icon name="sidebar" size={16} /></button
    >
  </div>
  <div data-doc-tree class="items" role="tree">
    {@render item(model.fixed[0]!, 'brief')}
    {@render item(model.fixed[1]!, 'arch')}
    {@render group('adr', model.adrs)}
    {#if model.groups.adr && model.adrs}
      <WindowedContent
        count={model.adrs}
        revision={docs.catalog.revision}
        read={(start) => docs.page('adr', start)}
        scroller=".items"
        gap={2}
        estimate={32}
      >
        {#snippet children(doc)}{@render item(doc, undefined, true)}{/snippet}
      </WindowedContent>
    {/if}
    {#if model.specs}
      {@render group('specs', model.specs)}
      {#if model.groups.specs}
        <WindowedContent
          count={model.specs}
          revision={docs.catalog.revision}
          read={(start) => docs.page('spec', start)}
          scroller=".items"
          gap={2}
          estimate={32}
        >
          {#snippet children(doc)}{@render item(doc, undefined, true)}{/snippet}
        </WindowedContent>
      {/if}
    {/if}
    {@render group('docs', model.free)}
    {#if model.groups.docs && model.free}
      <WindowedContent
        count={model.free}
        revision={docs.catalog.revision}
        read={(start) => docs.page('doc', start)}
        scroller=".items"
        gap={2}
        estimate={32}
      >
        {#snippet children(doc)}{@render item(doc, 'doc', true)}{/snippet}
      </WindowedContent>
    {/if}
  </div>
  <DocTreeFooter {model} />
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-doc-tree
    class="resize"
    role="separator"
    data-tip={t('docs.tree.resize')}
    onmousedown={model.resize}
  >
    <span data-doc-tree class="line" class:on={model.resizing}></span>
  </div>
</div>
