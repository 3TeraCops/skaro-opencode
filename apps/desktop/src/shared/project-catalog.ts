import type { ProjectCard } from './ipc-sessions';
export type ProjectSort = 'attention' | 'recent' | 'name';
export interface ProjectQuery {
  query: string;
  sort: ProjectSort;
  remember?: boolean;
}
export interface ProjectRange {
  key: string;
  revision: number;
  count: number;
}
export interface ProjectCatalogMethods {
  'projects.query': (query: ProjectQuery) => { source: ProjectRange; cards: ProjectCard[] };
  'projects.page': (source: ProjectRange, start: number) => ProjectCard[];
}
