<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { t } from '@skaro/ui';
  import type { C4Node } from './graph';
  import { kindKey } from './i18n';
  let { data, selected }: NodeProps<C4Node> = $props();
</script>

<div
  class="c4-node"
  class:boundary={data.boundary}
  class:external={data.element.external}
  class:planned={data.element.state === 'planned' || data.plannedChange}
  class:selected
  data-c4-element={data.element.id}
>
  <Handle type="target" position={Position.Left} />
  <span class="c4-node-kind"
    >{t(kindKey(data.element.kind))}{data.element.external ? ` · ${t('c4.external')}` : ''}</span
  >
  <strong class="c4-node-name"
    >{#each data.nameLines as line, i (i)}<span>{line}</span>{/each}</strong
  >
  {#if !data.boundary}
    {#if data.element.technology}<span class="c4-node-tech"
        >{#each data.technologyLines as line, i (i)}<span>{line}</span>{/each}</span
      >{/if}
    <span class="c4-node-description"
      >{#each data.descriptionLines as line, i (i)}<span>{line}</span>{/each}</span
    >
  {/if}
  <Handle type="source" position={Position.Right} />
</div>
