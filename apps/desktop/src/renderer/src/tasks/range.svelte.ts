import { untrack } from 'svelte';
import type { TaskSummary } from '../../../shared/ipc';
import type { ProjectTasks } from './data.svelte';
import type { TaskQuery, TaskRange, TaskEntry } from '../../../shared/task-catalog';
/** A view holds a range descriptor; WindowedContent owns only its visible pages. */
export class TaskRangeState {
  source = $state.raw<TaskRange>();
  revision = $state(0);
  error = $state<string>();
  private request: Promise<void> = Promise.resolve();
  private generation = 0;
  // Request results are published by revision; at most 12 bounded pages are retained.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly pages = new Map<number, Promise<TaskEntry[]>>();
  readonly query: () => TaskQuery;
  private readonly data: ProjectTasks;
  constructor(data: ProjectTasks, query: () => TaskQuery, enabled: () => boolean = () => true) {
    this.data = data;
    this.query = query;
    $effect(() => {
      void data.version;
      const generation = ++this.generation;
      if (!enabled()) {
        this.source = undefined;
        this.pages.clear();
        untrack(() => this.revision++);
        return;
      }
      const value = $state.snapshot(query());
      this.request = data
        .query(value)
        .then((source) => {
          if (this.generation !== generation) return;
          this.pages.clear();
          this.source = source;
          this.error = undefined;
          this.revision++;
        })
        .catch((error: unknown) => {
          if (this.generation === generation) this.error = String(error);
        });
    });
  }
  get identity(): string {
    return JSON.stringify([this.source?.projectId, this.query()]);
  }
  get count() {
    return this.source?.count ?? 0;
  }
  ready() {
    return this.request;
  }
  present(task: TaskSummary): TaskSummary {
    return this.data.present(task);
  }
  read = async (start: number): Promise<readonly TaskEntry[]> => {
    await this.request;
    if (!this.source) return [];
    let pending = this.pages.get(start);
    if (!pending) {
      pending = this.data.page(this.source, start).catch((error: unknown) => {
        if (this.pages.get(start) === pending) this.pages.delete(start);
        throw error;
      });
      this.pages.set(start, pending);
    } else {
      this.pages.delete(start);
      this.pages.set(start, pending);
    }
    while (this.pages.size > 12) this.pages.delete(this.pages.keys().next().value!);
    return pending;
  };
  async find(id: string) {
    await this.request;
    return this.source ? window.skaro.invoke('tasks.find', this.source, id) : -1;
  }
}
