<script lang="ts">
  import LoadingView from './LoadingView.svelte';
  import type { AgentInfo, ProjectInfo } from '../../../shared/ipc';
  import type { ProjectTasks } from '../tasks/data.svelte';
  const loadChatScreen = () => import('../chat/ChatScreen.svelte');
  const loadDocsScreen = () => import('../docs/DocsScreen.svelte');
  const loadPlanScreen = () => import('../plan/PlanScreen.svelte');
  const loadTaskScreen = () => import('../task/TaskScreen.svelte');
  const loadTasksScreen = () => import('../tasks/TasksScreen.svelte');
  const loadProjectParams = () => import('../params/ProjectParams.svelte');
  const loadC4Screen = () => import('../c4/C4Screen.svelte');
  const loadGraphScreen = () => import('../graph/GraphScreen.svelte');

  let {
    project,
    section,
    task,
    stage = false,
    chat = $bindable(),
    doc,
    data,
    agents,
    ontasks,
    openDoc,
    newChat,
    go,
    openTask,
    onremove,
    onchanged,
    onimport,
    graphTarget,
    c4Target = $bindable(),
    ongraph,
    onc4,
    onleave,
  }: {
    project: ProjectInfo;
    section: string;
    task?: string | undefined;
    /** The open task names a milestone: the screen of its stage, under "План". */
    stage?: boolean;
    chat?: string | undefined;
    doc?: string | undefined;
    data: ProjectTasks;
    agents: AgentInfo[];
    ontasks: () => void;
    openDoc: (path: string) => void;
    newChat: () => void;
    go: (id: string) => void;
    openTask: (id: string) => void;
    onremove: () => void;
    onchanged: () => void;
    onimport: () => void;
    graphTarget?: { elementId: string; viewId?: string } | undefined;
    c4Target?: { viewId: string; elementId?: string } | undefined;
    ongraph: (elementId: string, viewId: string) => void;
    onc4: (viewId: string, elementId?: string) => void;
    onleave: (guard: ((proceed: () => void) => void) | undefined) => void;
  } = $props();
</script>

{#if task && !stage && section === 'tasks'}
  {#key task}
    {#await loadTaskScreen()}<LoadingView />{:then { default: TaskScreen }}
      <TaskScreen
        projectId={project.id}
        taskId={task}
        {agents}
        {ontasks}
        onplan={ontasks}
        onopen={openTask}
        onspec={openDoc}
      />
    {/await}
  {/key}
{:else if section === 'c4'}
  {#await loadC4Screen()}<LoadingView />{:then { default: C4Screen }}
    <C4Screen projectId={project.id} bind:target={c4Target} {ongraph} />
  {/await}
{:else if section === 'graph'}
  {#await loadGraphScreen()}<LoadingView />{:then { default: GraphScreen }}
    <GraphScreen
      projectId={project.id}
      target={graphTarget}
      {onc4}
      ondoc={openDoc}
      ontask={openTask}
    />
  {/await}
{:else if section === 'docs'}
  {#await loadDocsScreen()}<LoadingView />{:then { default: DocsScreen }}
    <DocsScreen
      projectId={project.id}
      open={doc}
      tasks={data}
      onchat={newChat}
      ontask={openTask}
      {onimport}
      {onleave}
    />
  {/await}
{:else if section === 'plan'}
  {#await loadPlanScreen()}<LoadingView />{:then { default: PlanScreen }}
    <PlanScreen projectId={project.id} {data} onopen={openTask} onchat={newChat} />
  {/await}
{:else if section === 'params'}
  {#await loadProjectParams()}<LoadingView />{:then { default: ProjectParams }}
    <ProjectParams {project} {onremove} {onchanged} />
  {/await}
{:else if section === 'chat'}
  {#key project.id}
    {#await loadChatScreen()}<LoadingView />{:then { default: ChatScreen }}
      <ChatScreen {project} {agents} bind:chat onsection={go} {onimport} />
    {/await}
  {/key}
{:else}
  {#await loadTasksScreen()}<LoadingView />{:then { default: TasksScreen }}
    <TasksScreen projectId={project.id} {data} onopen={openTask} onnew={newChat} />
  {/await}
{/if}
