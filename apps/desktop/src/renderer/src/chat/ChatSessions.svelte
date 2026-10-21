<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { chatListViewport } from './chat-list-viewport.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  import ChatSessionRow from './ChatSessionRow.svelte';
  import LoadingView from '../screens/LoadingView.svelte';
  import type { ChatScreenController } from './chat-screen-controller.svelte';
  let { state: model }: { state: ChatScreenController } = $props();
  let content: { reveal(index: number): Promise<void> } | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  chatListViewport({
    state: () => model,
    root: () => list,
    reveal: (index) => content?.reveal(index),
  });
</script>

<div data-chat-screen class="sessions">
  <button
    data-chat-screen
    type="button"
    class="new"
    data-tip={t('chat.new.tip')}
    onclick={() => {
      model.tab = 'active';
      model.p.chat = 'new';
    }}
  >
    <Icon name="edit" size={14} stroke={1.9} />
    {t('chat.new')}
  </button>
  <div data-chat-screen class="list" bind:this={list}>
    {#if !model.list.loaded}<LoadingView />{/if}
    <WindowedContent
      bind:this={content}
      count={model.list.count}
      revision={model.list.revision}
      identity={model.list.identity}
      read={model.list.read}
      scroller=".list[data-chat-screen]"
      gap={2}
      estimate={model.tab === 'archive' ? 32 : 30}
    >
      {#snippet children(item)}
        <ChatSessionRow
          {item}
          selected={model.p.chat}
          onselect={(id) => (model.p.chat = id)}
          onrestore={model.restore}
        />
      {/snippet}
    </WindowedContent>
    {#if model.list.loaded && model.list.count === 0}
      <span data-chat-screen class="list-empty"
        >{model.tab === 'archive' ? t('chat.list.emptyArchive') : t('chat.list.empty')}</span
      >
    {/if}
  </div>
  <div data-chat-screen class="foot">
    <button
      data-chat-screen
      type="button"
      class="archive-toggle"
      class:on={model.tab === 'archive'}
      data-tip={model.archiveTip}
      aria-label={model.archiveTip}
      aria-pressed={model.tab === 'archive'}
      onclick={() => (model.tab = model.tab === 'archive' ? 'active' : 'archive')}
    >
      <Icon name="archive" size={15} stroke={1.8} />
    </button>
  </div>
</div>
