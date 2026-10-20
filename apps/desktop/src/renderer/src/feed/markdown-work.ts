interface Request {
  id: number;
  text: string;
  resolve(parts: string[]): void;
  reject(error: Error): void;
  cancelled: boolean;
}
/** One worker and one pending version per mounted message, including during token streaming. */
class MarkdownWork {
  private worker?: Worker;
  private serial = 0;
  private active?: Request;
  private readonly queued: Request[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private readonly cache = new Map<string, string[]>();
  private bytes = 0;
  request(text: string) {
    const cached = this.cache.get(text);
    if (cached !== undefined) return { result: Promise.resolve(cached), cancel() {} };
    let request!: Request;
    const result = new Promise<string[]>((resolve, reject) => {
      request = { id: ++this.serial, text, resolve, reject, cancelled: false };
      this.queued.push(request);
      this.pump();
    });
    return {
      result,
      cancel: () => {
        request.cancelled = true;
        const index = this.queued.indexOf(request);
        if (index >= 0) this.queued.splice(index, 1);
        request.resolve([]);
      },
    };
  }
  private pump() {
    clearTimeout(this.timer);
    if (this.active) return;
    const next = this.queued.shift();
    if (!next) {
      this.timer = setTimeout(() => {
        this.worker?.terminate();
        this.worker = undefined;
      }, 15_000);
      return;
    }
    this.active = next;
    if (!this.worker) {
      this.worker = new Worker(new URL('./markdown-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (
        event: MessageEvent<{ id: number; parts?: string[]; error?: string }>,
      ) => {
        const current = this.active;
        if (!current || current.id !== event.data.id) return;
        // One completed message per browser task; layout/input can run between updates.
        setTimeout(() => {
          try {
            if (!current.cancelled) {
              if (event.data.error) throw new Error(event.data.error);
              const parts = event.data.parts ?? [];
              this.remember(current.text, parts);
              current.resolve(parts);
            }
          } catch (error) {
            current.reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            this.active = undefined;
            this.pump();
          }
        }, 0);
      };
      this.worker.onerror = (event) => {
        this.active?.reject(new Error(event.message));
        this.active = undefined;
        this.worker?.terminate();
        this.worker = undefined;
        this.pump();
      };
    }
    this.worker.postMessage({ id: next.id, text: next.text });
  }
  private remember(text: string, parts: string[]) {
    const bytes = (key: string, value: string[]) =>
      (key.length + value.reduce((sum, part) => sum + part.length, 0)) * 2;
    const size = bytes(text, parts);
    if (size > 1_000_000) return;
    const previous = this.cache.get(text);
    if (previous !== undefined) this.bytes -= bytes(text, previous);
    this.cache.set(text, parts);
    this.bytes += size;
    for (const [key, value] of this.cache) {
      if (this.bytes <= 2_000_000) break;
      this.cache.delete(key);
      this.bytes -= bytes(key, value);
    }
  }
}
const work = new MarkdownWork();
export const agentMarkdown = (text: string) => work.request(text);
