<script lang="ts">
  import { Banner, Button, Icon, Segmented, t, TextField } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import { agentReady } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { agentName } from '../feed/format';
  import { ProjectsBoardState } from './projects-board.svelte';
  import ProjectOverviewCard from './ProjectOverviewCard.svelte';
  import ProjectsList from './ProjectsList.svelte';
  import WindowedContent from '../WindowedContent.svelte';
  import './projects-board.css';
  import './project-card-runs.css';
  import './projects-list.css';
  let {
    onopen,
    onadd,
    onsettings,
    onchanged,
  }: {
    onopen: (id: string) => void;
    onadd: () => void;
    onsettings: () => void;
    onchanged: () => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  const state = new ProjectsBoardState(onchanged);
  onDestroy(() => state.dispose());
  const missingAgents = $derived(agents.list.filter((a) => !a.checking && !agentReady(a)));
  const readyAgents = $derived(agents.list.filter(agentReady));
</script>

<div class="projects">
  <div class="head">
    <h1 class="title">{t('app.home')}</h1>
    <Button variant="primary" data-tip={t('home.add.tip')} onclick={onadd}
      ><Icon name="plus" size={15} stroke={2.6} />{t('home.add')}</Button
    >
  </div>

  {#if missingAgents.length && readyAgents.length && !agents.bannerHidden}
    <div class="banner">
      <Banner
        kind="warning"
        title={t('home.agent.missing', {
          name: missingAgents.map((a) => agentName(a.id)).join(', '),
        })}
        text={t('home.agent.missing.text', {
          ready: readyAgents.map((a) => agentName(a.id)).join(', '),
        })}
        action={t('home.agent.settings')}
        onaction={onsettings}
        onclose={() => (agents.bannerHidden = true)}
      />
    </div>
  {/if}

  <div class="toolbar">
    <div class="search">
      <TextField search placeholder={t('projects.search')} bind:value={state.query} />
    </div>
    <Segmented
      bind:value={() => state.sort, (v) => ((state.sort = v), state.remember())}
      label={t('projects.sort')}
      options={[
        { value: 'attention', label: t('projects.sort.attention') },
        { value: 'recent', label: t('projects.sort.recent') },
        { value: 'name', label: t('projects.sort.name') },
      ]}
    />
    <span class="spacer"></span>
    <Segmented
      bind:value={() => state.view, (v) => ((state.view = v), state.remember())}
      label={t('projects.view')}
      options={[
        { value: 'grid', label: t('projects.view.grid'), icon: 'grid' },
        { value: 'list', label: t('projects.view.list'), icon: 'list' },
      ]}
    />
  </div>

  {#if state.loaded && state.query.trim() && !state.source.count}
    <div class="nothing">
      <div class="nothing-title">{t('projects.nothing')}</div>
      <div class="nothing-text">{t('projects.nothing.text', { q: state.query.trim() })}</div>
    </div>
  {:else if state.view === 'grid'}
    <WindowedContent
      count={Math.ceil(state.source.count / 3)}
      revision={state.source.revision}
      read={(start) => state.gridRows(start)}
      gap={13}
      estimate={220}
    >
      {#snippet children(row)}
        <div class="grid">
          {#each row.cards as c (c.id)}<ProjectOverviewCard
              {c}
              {onopen}
              relocate={(c) => state.relocate(c)}
              remove={(id) => state.remove(id)}
            />{/each}
        </div>
      {/snippet}
    </WindowedContent>
  {:else}
    <ProjectsList {state} {onopen} />
  {/if}
</div>
