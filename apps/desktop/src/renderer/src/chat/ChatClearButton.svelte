<script lang="ts">
  import { ConfirmDialog, Icon, t } from '@skaro/ui';
  import { cleanError } from '../feed/action-error';
  let {
    projectId,
    chatId,
    disabled,
    task = false,
    floating = false,
    onerror,
  }: {
    projectId: string;
    chatId: string;
    disabled: boolean;
    task?: boolean;
    floating?: boolean;
    onerror: (error: string) => void;
  } = $props();
  let confirm = $state(false);
  let clearing = $state(false);
  async function clear() {
    clearing = true;
    try {
      await window.skaro.invoke(task ? 'task.clear' : 'chat.clear', projectId, chatId);
    } catch (error) {
      onerror(cleanError(error));
    } finally {
      clearing = false;
    }
  }
</script>

<button
  type="button"
  class="archive"
  class:compact={task}
  class:floating
  data-tip={t(disabled ? 'chat.clear.busy' : 'chat.clear')}
  aria-label={t('chat.clear')}
  disabled={disabled || clearing}
  onclick={() => (confirm = true)}
>
  <Icon name="trash" size={14} stroke={1.8} />
</button>
<ConfirmDialog
  bind:open={confirm}
  title={t('chat.clear')}
  text={t('chat.clear.confirm')}
  action={t('chat.clear.action')}
  onconfirm={() => void clear()}
/>

<style>
  button {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-23);
    cursor: pointer;
  }
  button:hover {
    background: var(--sk-selected);
    color: var(--sk-text-6);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.compact {
    width: 24px;
    height: 24px;
  }
  button.floating {
    position: absolute;
    top: 10px;
    right: 14px;
    z-index: 4;
    background: var(--sk-bg);
  }
</style>
