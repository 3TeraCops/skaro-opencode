<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProjectInfo } from '../../../shared/ipc';
  import ProjectsBoard from './ProjectsBoard.svelte';
  import appIcon from '../../../../build/icon.png';

  /** "Проекты": the start screen without projects, else the board of project cards. */
  let {
    projects,
    onopen,
    onadd,
    onsettings,
    onchanged,
  }: {
    projects: ProjectInfo[];
    onopen: (id: string) => void;
    onadd: () => void;
    onsettings: () => void;
    onchanged: () => void;
  } = $props();
</script>

{#if projects.length === 0}
  <div class="empty">
    <div class="mark">
      <img src={appIcon} width="48" height="48" alt="" />
    </div>
    <div class="copy">
      <div class="empty-title">{t('home.empty.title')}</div>
      <div class="empty-text">{t('home.empty.text')}</div>
    </div>
    <button type="button" class="create" onclick={onadd}>
      <Icon name="plus" size={15} stroke={2.6} />{t('home.empty.create')}
    </button>
  </div>
{:else}
  <ProjectsBoard {onopen} {onadd} {onsettings} {onchanged} />
{/if}

<style>
  /* 07 · Проекты, empty state: centred in the whole content area. */
  .empty {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    text-align: center;
  }

  .mark {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    background: var(--sk-surface);
  }

  .copy {
    max-width: 440px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-title {
    font-size: var(--sk-fs-14);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .empty-text {
    font-size: var(--sk-fs-8);
    line-height: 1.6;
    color: var(--sk-text-17);
    text-wrap: pretty;
  }

  .create {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 18px;
    border: none;
    border-radius: var(--sk-radius);
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-size: var(--sk-fs-8);
    font-weight: 700;
    cursor: pointer;
  }

  .create:hover {
    background: var(--sk-accent-hover);
  }

  .create:active {
    transform: translateY(1px);
  }
</style>
