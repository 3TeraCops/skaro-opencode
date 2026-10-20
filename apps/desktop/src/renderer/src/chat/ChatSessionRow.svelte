<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ChatSummary } from '../../../shared/ipc';
  let {
    item,
    selected,
    onselect,
    onrestore,
  }: {
    item: ChatSummary;
    selected?: string;
    onselect(id: string): void;
    onrestore(id: string): void;
  } = $props();
</script>

<div
  data-chat-screen
  class="row"
  data-chat-id={item.id}
  class:on={item.id === selected}
  role="button"
  tabindex="0"
  onclick={() => onselect(item.id)}
  onkeydown={(e) => e.key === 'Enter' && onselect(item.id)}
>
  {#if item.kind === 'import'}
    <span data-chat-screen class="row-icon" data-tip={t('chat.import.tip')}
      ><Icon name="import" size={14} stroke={1.8} /></span
    >
  {/if}
  <span data-chat-screen class="row-title" data-tip={item.title}>{item.title}</span>
  {#if item.live}
    <span data-chat-screen class="live" data-tip={t('chat.live')}></span>
  {/if}
  {#if item.archived}
    <button
      data-chat-screen
      type="button"
      class="restore"
      data-tip={t('chat.restore')}
      aria-label={t('chat.restore')}
      onclick={(e) => {
        e.stopPropagation();
        onrestore(item.id);
      }}
    >
      <Icon name="unarchive" size={14} stroke={1.9} />
    </button>
  {/if}
</div>
