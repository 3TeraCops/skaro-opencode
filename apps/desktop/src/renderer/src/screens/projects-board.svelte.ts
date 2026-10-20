import { projectOverview } from '../project-overview.svelte';
import type { ProjectCard } from '../../../shared/ipc';
import type { ProjectRange, ProjectSort } from '../../../shared/project-catalog';
export type { ProjectSort } from '../../../shared/project-catalog';
export type ProjectView = 'grid' | 'list';
let preferences = window.skaro.bootstrap?.projectsView;
let viewport: ProjectCard[] | undefined;
function firstCards() {
  if (viewport) return viewport;
  const query = preferences?.query?.trim().toLowerCase() ?? '';
  const cards = projectOverview.cards.filter(
    (card) => !query || `${card.name} ${card.path}`.toLowerCase().includes(query),
  );
  const score = (card: ProjectCard) =>
    card.counts.needs * 10 + card.counts.review * 5 + card.counts.failed * 3;
  return cards.toSorted((a, b) =>
    preferences?.sort === 'name'
      ? a.name.localeCompare(b.name, 'ru')
      : preferences?.sort === 'recent'
        ? b.activeAt - a.activeAt
        : score(b) - score(a) || b.activeAt - a.activeAt,
  );
}

export class ProjectsBoardState {
  query = $state(preferences?.query ?? '');
  sort = $state<ProjectSort>(preferences?.sort ?? 'attention');
  view = $state<ProjectView>(preferences?.view ?? 'grid');
  loaded = $state(false);
  source = $state.raw<ProjectRange>({
    key: 'bootstrap',
    revision: 0,
    count: firstCards().length,
  });
  private initial = $state.raw<ProjectCard[]>(firstCards());
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly off: () => void;
  private readonly onchanged: () => void;
  constructor(onchanged: () => void) {
    this.onchanged = onchanged;
    $effect(() => {
      void this.query;
      void this.sort;
      this.remember();
      void this.reload();
    });
    if (!window.skaro.bootstrap)
      void window.skaro.invoke('app.getSetting', 'ui.projects').then((value) => {
        const saved = value as { sort?: ProjectSort; view?: ProjectView } | null;
        if (saved?.sort) this.sort = saved.sort;
        if (saved?.view) this.view = saved.view;
      });
    this.off = window.skaro.on('projects.card', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.reload(), 30);
    });
  }
  async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const result = await window.skaro.invoke('projects.query', {
        query: this.query,
        sort: this.sort,
        remember: true,
      });
      if (generation !== this.generation) return;
      this.source = result.source;
      this.initial = result.cards;
      viewport = result.cards;
      this.loaded = true;
    } catch (error) {
      console.error('Project registry:', error);
    }
  }
  async page(start: number): Promise<ProjectCard[]> {
    const source = this.source;
    if (start < this.initial.length) return this.initial.slice(start, start + 48);
    if (source.key === 'bootstrap') return [];
    return window.skaro.invoke('projects.page', source, start);
  }
  async gridRows(start: number) {
    const cards = await this.page(start * 3);
    return Array.from({ length: Math.ceil(cards.length / 3) }, (_, offset) => ({
      id: String(start + offset),
      cards: cards.slice(offset * 3, offset * 3 + 3),
    }));
  }
  async listRows(start: number) {
    return (await this.page(start))
      .slice(0, 16)
      .map((card, offset) => ({ id: String(start + offset), card }));
  }
  remember(): void {
    preferences = { query: this.query, sort: this.sort, view: this.view };
    void window.skaro.invoke('app.setSetting', 'ui.projects', {
      sort: this.sort,
      view: this.view,
      query: this.query,
    });
  }
  async remove(id: string): Promise<void> {
    await window.skaro.invoke('projects.remove', id);
    this.onchanged();
    await this.reload();
  }
  async relocate(card: ProjectCard): Promise<void> {
    const path = await window.skaro.invoke('projects.pickFolder', undefined);
    if (!path) return;
    await window.skaro.invoke('projects.relocate', card.id, path);
    this.onchanged();
    await this.reload();
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.off();
  }
}
