import type { TaskSummary } from '../../../shared/ipc';
import type { TaskRange } from '../../../shared/task-catalog';
import { taskMatches } from '../../../shared/task-presentation';
import type { ProjectTasks } from './data.svelte';
import { selectTasks } from './selection';
interface Intent {
  source: TaskRange;
  on: boolean;
  sequence: number;
}
/** Selection intent renders synchronously; only explicit selected records are materialized. */
export class TaskSelection {
  ids = $state<string[]>([]);
  private records = $state.raw<TaskSummary[]>([]);
  private pending = $state.raw<Intent[]>([]);
  private manual = $state.raw<{ task: TaskSummary; on: boolean; sequence: number }[]>([]);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Rebuilt membership for the current selection.
  private selected = $derived(new Set(this.ids));
  private generation = 0;
  private sequence = 0;
  private clearVersion = 0;
  // Sequence bookkeeping has no independent reactive lifetime.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly applied = new Map<string, number>();
  constructor(project: string, data: ProjectTasks) {
    $effect(() => {
      void data.version;
      const ids = $state.snapshot(this.ids),
        generation = ++this.generation;
      if (!ids.length) {
        this.records = [];
        return;
      }
      void window.skaro.invoke('tasks.selected', project, ids).then((records) => {
        if (generation !== this.generation) return;
        this.records = records;
        if (records.length !== ids.length) {
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Transient membership of this result.
          const retained = new Set(records.map((task) => task.id));
          this.ids = ids.filter((id) => retained.has(id));
        }
      });
    });
  }
  get picked(): TaskSummary[] {
    return this.records.filter((task) => this.selected.has(task.id));
  }
  has(task: TaskSummary): boolean {
    let on = this.selected.has(task.id),
      sequence = this.applied.get(task.id) ?? 0;
    for (const intent of this.pending)
      if (intent.sequence > sequence && taskMatches(task, intent.source.query)) {
        on = intent.on;
        sequence = intent.sequence;
      }
    return on;
  }
  all(source: TaskRange | undefined): boolean {
    if (!source?.count) return false;
    const intent = this.pending.findLast((value) => value.source.key === source.key);
    if (intent) {
      const later = this.manual.filter(
        (value) => value.sequence > intent.sequence && taskMatches(value.task, source.query),
      );
      return intent.on
        ? later.every((value) => value.on)
        : later.filter((value) => value.on).length === source.count;
    }
    return this.picked.filter((task) => taskMatches(task, source.query)).length === source.count;
  }
  select(id: string, on: boolean, task?: TaskSummary) {
    const sequence = ++this.sequence;
    this.applied.set(id, sequence);
    if (task && this.pending.length)
      this.manual = [
        ...this.manual.filter((value) => value.task.id !== id),
        { task, on, sequence },
      ];
    this.ids = selectTasks(this.ids, [id], on);
  }
  clear() {
    this.clearVersion++;
    this.generation++;
    this.pending = [];
    this.manual = [];
    this.applied.clear();
    this.ids = [];
    this.records = [];
  }
  async column(source: TaskRange, on: boolean) {
    const version = this.clearVersion,
      intent: Intent = { source, on, sequence: ++this.sequence };
    this.pending = [...this.pending.filter((value) => value.source.key !== source.key), intent];
    try {
      const records = await window.skaro.invoke('tasks.select', source);
      if (
        version !== this.clearVersion ||
        !this.pending.some((value) => value.sequence === intent.sequence)
      )
        return;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Apply this resolved batch atomically.
      const ids = new Set(this.ids);
      for (const task of records)
        if ((this.applied.get(task.id) ?? 0) <= intent.sequence) {
          this.applied.set(task.id, intent.sequence);
          if (on) ids.add(task.id);
          else ids.delete(task.id);
        }
      this.ids = [...ids];
      // Keep the established canonical order until the normal indexed refresh reconciles metadata.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Merge only explicitly selected records.
      const known = new Map([...this.records, ...records].map((task) => [task.id, task]));
      this.records = [...known.values()]
        .filter((task) => ids.has(task.id))
        .toSorted((a, b) => a.id.localeCompare(b.id));
    } finally {
      this.pending = this.pending.filter((value) => value.sequence !== intent.sequence);
      if (!this.pending.length) this.manual = [];
    }
  }
}
