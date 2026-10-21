<script lang="ts">
  import { Icon, type IconName } from '@skaro/ui';
  let {
    title,
    selected = false,
    muted = false,
    tip,
    icon,
    number,
    proposed = false,
    onselect,
  }: {
    title: string;
    selected?: boolean;
    muted?: boolean;
    tip?: string | undefined;
    icon?: IconName | undefined;
    number?: string | undefined;
    proposed?: boolean;
    onselect: () => void;
  } = $props();
</script>

<div
  data-doc-tree
  class="item"
  class:on={selected}
  class:muted
  role="treeitem"
  aria-selected={selected}
  tabindex="0"
  data-tip={tip}
  onclick={onselect}
  onkeydown={(e) => e.key === 'Enter' && onselect()}
>
  {#if icon}<span data-doc-tree class="icon"><Icon name={icon} size={15} /></span>
  {:else}<span data-doc-tree class="num">{number}</span>{/if}
  <span data-doc-tree class="label">{title}</span>
  {#if proposed}<span data-doc-tree class="dot"></span>{/if}
</div>
