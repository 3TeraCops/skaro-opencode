import type { ProjectArtifacts } from '@skaro/core';

export interface ArtifactSnapshot {
  value: ProjectArtifacts;
  bytes: number;
}
interface Entry {
  promise: Promise<ProjectArtifacts>;
  bytes: number;
}
/** A cache owns only disposable reads. Callers keep their operation's snapshot through eviction. */
export class ProjectArtifactMemory {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private readonly budget: number;
  constructor(budget = 32 * 1024 * 1024) {
    this.budget = budget;
  }
  read(key: string, load: () => Promise<ArtifactSnapshot>): Promise<ProjectArtifacts> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }
    const entry: Entry = {
      bytes: 0,
      promise: Promise.resolve()
        .then(load)
        .then(({ value, bytes }) => {
          if (this.entries.get(key) === entry) {
            entry.bytes = Math.max(0, bytes);
            this.bytes += entry.bytes;
            this.trim();
          }
          return value;
        })
        .catch((error: unknown) => {
          if (this.entries.get(key) === entry) this.forget(key);
          throw error;
        }),
    };
    this.entries.set(key, entry);
    this.trim();
    return entry.promise;
  }
  forget(key: string): void {
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
  private trim(): void {
    while (this.bytes > this.budget || this.entries.size > 32) {
      const key = this.entries.keys().next().value;
      if (key === undefined) break;
      this.forget(key);
    }
  }
}
