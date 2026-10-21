<script lang="ts">
  import ChatClearButton from '../chat/ChatClearButton.svelte';
  import '../chat/i18n';
  import type { TaskController } from './task-controller.svelte';
  let {
    controller,
    projectId,
    taskId,
    floating = false,
  }: {
    controller: TaskController;
    projectId: string;
    taskId: string;
    floating?: boolean;
  } = $props();
</script>

<ChatClearButton
  {projectId}
  chatId={taskId}
  task
  {floating}
  disabled={controller.running ||
    controller.starting ||
    !!controller.view?.queued ||
    !controller.hasFeed}
  onerror={(error) => (controller.actionError = error)}
/>
