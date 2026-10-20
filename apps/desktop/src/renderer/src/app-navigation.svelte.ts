import type { ProjectTab } from '@skaro/ui';
import type { ProjectInfo, TabsState } from '../../shared/ipc';
import { agents, watchAgents } from './agents.svelte';
import { applyFeedFont } from './settings/setting.svelte';
import { tabStates, watchTabStates } from './tab-states.svelte';
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { onMount } from 'svelte';
import { bootstrap } from './bootstrap';

type View = 'home' | 'project' | 'settings' | 'inventory';

/** Navigation and persisted tabs; views remain composition-only. */
export function createNavigation() {
  const initial = bootstrap;
  let projects = $state<ProjectInfo[]>(initial?.projects.map((project) => ({ ...project })) ?? []);
  let tabs = $state<TabsState>({ ...initial?.tabs, projects: [...(initial?.tabs.projects ?? [])] });
  let view = $state<View>(initial?.workspace?.view ?? (initial?.tabs.active ? 'project' : 'home'));
  let loaded = $state(!!initial);
  /** Selected section per project; the panel state is shared by all projects. */
  let sections = $state<Record<string, string>>({ ...initial?.workspace?.sections });
  /** Open task per project ("Задачи" section). */
  let openTasks = $state<Record<string, string | undefined>>({ ...initial?.workspace?.openTasks });
  /** Open chat per project ("Чат" section). */
  let openChats = $state<Record<string, string | undefined>>({ ...initial?.workspace?.openChats });
  let panelCollapsed = $state(initial?.panelCollapsed ?? false);
  if (initial?.feedFont) applyFeedFont(initial.feedFont);

  const projectTabs = $derived<ProjectTab[]>(
    tabs.projects
      .map((id) => projects.find((p) => p.id === id))
      .filter((p): p is ProjectInfo => p !== undefined)
      .map((p) => ({ id: p.id, label: p.name, state: tabStates.byProject[p.id] ?? 'none' })),
  );
  const activeProject = $derived(
    view === 'project' ? projects.find((p) => p.id === tabs.active) : undefined,
  );

  watchAgents();
  watchTabStates();

  // Without a ready agent there is nothing Skaro can do: only "Настройки" → "Агенты" is open.
  $effect(() => {
    if (agents.none && view !== 'settings' && view !== 'inventory') view = 'settings';
  });

  onMount(() => {
    if (initial) return;
    void Promise.all([
      window.skaro.invoke('projects.list'),
      window.skaro.invoke('tabs.get'),
      window.skaro.invoke('app.getSetting', 'ui.feedFont'),
      window.skaro.invoke('app.getSetting', 'ui.navCollapsed'),
      window.skaro.invoke('app.getSetting', 'ui.workspace'),
    ]).then(([list, savedTabs, font, collapsed, saved]) => {
      projects = list;
      tabs = savedTabs;
      const workspace = saved as import('../../shared/ipc').WorkspaceState | null;
      if (workspace) {
        sections = workspace.sections;
        openTasks = workspace.openTasks;
        openChats = workspace.openChats;
      }
      view = new SvelteURLSearchParams(location.search).has('inventory')
        ? 'inventory'
        : (workspace?.view ?? (tabs.active ? 'project' : 'home'));
      applyFeedFont(font as string | null);
      panelCollapsed = collapsed === true;
      loaded = true;
    });
  });

  $effect(() => {
    if (!loaded) return;
    void window.skaro.invoke(
      'app.setSetting',
      'ui.workspace',
      $state.snapshot({ view, sections, openTasks, openChats }),
    );
  });

  // Open tabs survive restarts (plan: stage 4).
  $effect(() => {
    if (!loaded) return;
    void window.skaro.invoke('tabs.set', $state.snapshot(tabs));
  });

  $effect(() => {
    if (loaded) void window.skaro.invoke('app.setSetting', 'ui.navCollapsed', panelCollapsed);
  });

  async function openProject(id: string): Promise<void> {
    if (!projects.some((project) => project.id === id)) {
      const project = await window.skaro.invoke('projects.get', id);
      projects = [...projects, project];
    }
    tabs = {
      projects: tabs.projects.includes(id) ? tabs.projects : [...tabs.projects, id],
      active: id,
    };
    view = 'project';
  }

  function closeTab(id: string): void {
    const index = tabs.projects.indexOf(id);
    const rest = tabs.projects.filter((p) => p !== id);
    if (tabs.active !== id) {
      tabs = { ...tabs, projects: rest };
      return;
    }
    const next = rest[Math.min(index, rest.length - 1)];
    tabs = next ? { projects: rest, active: next } : { projects: rest };
    view = next ? 'project' : 'home';
  }

  function goHome(): void {
    tabs = { projects: tabs.projects };
    view = 'home';
  }

  let newProject = $state(false);

  function addProject(): void {
    newProject = true;
  }

  async function refreshProjects(): Promise<void> {
    const [registry, savedTabs] = await Promise.all([
      window.skaro.invoke('projects.query', { query: '', sort: 'attention' }),
      window.skaro.invoke('tabs.get'),
    ]);
    const records: ProjectInfo[] = registry.cards.map(({ id, name, path, logo, missing }) => ({
      id,
      name,
      path,
      logo,
      missing,
    }));
    const extra = await Promise.all(
      savedTabs.projects
        .filter((id) => !records.some((record) => record.id === id))
        .map((id) => window.skaro.invoke('projects.get', id)),
    );
    projects = [...records, ...extra];
    tabs = savedTabs;
    if (view === 'project' && !savedTabs.active) view = 'home';
  }
  async function projectRemoved(id: string): Promise<void> {
    closeTab(id);
    await refreshProjects();
  }
  async function projectAdded(project: ProjectInfo): Promise<void> {
    await refreshProjects();
    await openProject(project.id);
  }

  return {
    get projects() {
      return projects;
    },
    set projects(value: typeof projects) {
      projects = value;
    },
    get tabs() {
      return tabs;
    },
    set tabs(value: typeof tabs) {
      tabs = value;
    },
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get loaded() {
      return loaded;
    },
    set loaded(value: typeof loaded) {
      loaded = value;
    },
    get sections() {
      return sections;
    },
    set sections(value: typeof sections) {
      sections = value;
    },
    get openTasks() {
      return openTasks;
    },
    set openTasks(value: typeof openTasks) {
      openTasks = value;
    },
    get openChats() {
      return openChats;
    },
    set openChats(value: typeof openChats) {
      openChats = value;
    },
    get panelCollapsed() {
      return panelCollapsed;
    },
    set panelCollapsed(value: typeof panelCollapsed) {
      panelCollapsed = value;
    },
    get newProject() {
      return newProject;
    },
    set newProject(value: typeof newProject) {
      newProject = value;
    },
    get projectTabs() {
      return projectTabs;
    },
    get activeProject() {
      return activeProject;
    },
    openProject,
    closeTab,
    goHome,
    addProject,
    projectRemoved,
    projectAdded,
    refreshProjects,
  };
}
