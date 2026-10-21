import { watch, type FSWatcher } from 'node:fs';
import { allowed, slash } from './source-policy';

export class GraphWatch {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly onChange: (id: string) => void;
  private readonly onError: (id: string, error: Error) => void;
  constructor(onChange: (id: string) => void, onError: (id: string, error: Error) => void) {
    this.onChange = onChange;
    this.onError = onError;
  }
  add(id: string, root: string): void {
    this.remove(id);
    try {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        const path = slash(String(filename ?? ''));
        if (path && !allowed(path) && !/^\.git\/(?:HEAD|index|refs\/)/.test(path)) return;
        clearTimeout(this.timers.get(id));
        const timer = setTimeout(() => {
          this.timers.delete(id);
          this.onChange(id);
        }, 650);
        timer.unref();
        this.timers.set(id, timer);
      });
      watcher.unref();
      watcher.on('error', (error) => this.onError(id, error));
      this.watchers.set(id, watcher);
    } catch (error) {
      this.onError(id, error instanceof Error ? error : new Error(String(error)));
    }
  }
  remove(id: string): void {
    this.watchers.get(id)?.close();
    this.watchers.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
  close(): void {
    for (const id of this.watchers.keys()) this.remove(id);
  }
}
