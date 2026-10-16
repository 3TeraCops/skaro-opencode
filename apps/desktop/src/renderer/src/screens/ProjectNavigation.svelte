<script lang="ts">
  import { i18n, NavPanel, t, tn, type NavItem, type NavTask } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { ProjectInfo } from '../../../shared/ipc';
  import type { ProjectTasks } from '../tasks/data.svelte';
  import { activeTasks, needsYou, statusLabel } from '../tasks/model';
  import '../limits/i18n';
  import { NavigationWidth } from './navigation-width.svelte';
  import { ProjectLimits } from '../limits/project-limits.svelte';
  import { lowPercentLabel } from '../limits/low-remaining';
  let {
    project,
    data,
    section,
    collapsed = $bindable(false),
    onselect,
    ontask,
    onlimits,
  }: {
    project: ProjectInfo;
    data: ProjectTasks;
    section: string;
    collapsed?: boolean;
    onselect: (id: string) => void;
    ontask: (id: string) => void;
    onlimits: () => void;
  } = $props();
  const navigation = new NavigationWidth();
  onDestroy(() => navigation.dispose());
  // The navigation is mounted for the current project only.
  // svelte-ignore state_referenced_locally
  const limits = new ProjectLimits(project.id);
  onDestroy(() => limits.dispose());
  const limitPercent = $derived(
    limits.remaining === undefined ? undefined : lowPercentLabel(limits.remaining, i18n.locale),
  );
  const attention = $derived(data.tasks.filter((x) => !x.archived && needsYou(x)).length);
  const stagesWaiting = $derived(
    data.stages.filter((s) =>
      ['acceptance_needs_answer', 'awaiting_merge', 'error'].includes(s.state),
    ).length,
  );
  const items = $derived<NavItem[]>([
    {
      id: 'tasks',
      label: t('nav.tasks'),
      tip: t('nav.tasks.tip'),
      icon: 'tasks',
      count: attention,
      countTip: t('board.attention.tip'),
      railTip: tn('board.attention.rail', attention),
    },
    { id: 'docs', label: t('nav.docs'), tip: t('nav.docs.tip'), icon: 'docs' },
    {
      id: 'plan',
      label: t('nav.plan'),
      tip: t('nav.plan.tip'),
      icon: 'plan',
      count: stagesWaiting,
      countTip: t('plan.attention.tip'),
      railTip: tn('plan.attention.rail', stagesWaiting),
    },
    { id: 'chat', label: t('nav.chat'), tip: t('nav.chat.tip'), icon: 'chat', separated: true },
    { id: 'params', label: t('nav.params'), tip: t('nav.params.tip'), icon: 'params' },
  ]);
  const navTasks = $derived<NavTask[]>(
    activeTasks(data.tasks).map(({ task, kind }) => ({
      id: task.id,
      title: task.title,
      tip: `${task.id.replace(/^T-0*(\d+)$/, 'T$1')} · ${task.title}`,
      sub: `${statusLabel(task.status)} · ${
        task.milestone ? `${task.milestone.id} · ${task.milestone.title}` : t('board.loose')
      }`,
      kind,
    })),
  );
</script>

<NavPanel
  title={project.name}
  logo={project.logo}
  {items}
  active={section}
  bind:collapsed
  bind:width={navigation.width}
  onresize={() => navigation.save()}
  tasks={navTasks}
  {ontask}
  {onselect}
  footerItem={{
    id: 'limits',
    label: t('limits.title'),
    icon: 'circleGauge',
    trailing: limitPercent,
  }}
  onfooter={onlimits}
/>
