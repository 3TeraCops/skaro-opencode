import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface Reply {
  id: number;
  value?: unknown;
  error?: string;
  progress?: { done: number; total: number; stage: string };
}
export class GraphWorkerClient {
  private worker?: Worker;
  private serial = 0;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      progress?: (progress: NonNullable<Reply['progress']>) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  call<T>(
    operation: string,
    args: unknown,
    progress?: (progress: NonNullable<Reply['progress']>) => void,
  ): Promise<T> {
    if (!this.worker) {
      const bundled = join(__dirname, 'graph-worker.js'),
        chunked = join(__dirname, '../graph-worker.js'),
        built = join(__dirname, '../../../out/main/graph-worker.js');
      const entry = existsSync(bundled) ? bundled : existsSync(chunked) ? chunked : built;
      const worker = (this.worker = new Worker(entry, {
        resourceLimits: { maxOldGenerationSizeMb: 1536 },
      }));
      worker.unref();
      worker.on('message', (reply: Reply) => {
        const request = this.pending.get(reply.id);
        if (!request) return;
        if (reply.progress) {
          request.progress?.(reply.progress);
          return;
        }
        this.pending.delete(reply.id);
        clearTimeout(request.timer);
        if (!this.pending.size) worker.unref();
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.value);
      });
      worker.on('error', (error) => this.failed(worker, error));
      worker.on('exit', (code) => this.failed(worker, new Error(`Graph worker exited (${code})`)));
    }
    const worker = this.worker,
      id = ++this.serial;
    worker.ref();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(progress ? { progress } : {}),
        timer: setTimeout(
          () => {
            console.error('Graph worker timed out:', operation);
            this.failed(worker, new Error('graph-worker-time-budget'));
            void worker.terminate();
          },
          operation === 'index' ? 180_000 : operation === 'prune' ? 60_000 : 15_000,
        ),
      });
      worker.postMessage({ id, operation, args });
    });
  }
  private failed(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
  async close(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.failed(worker, new Error('graph-cancelled'));
    await worker.terminate();
  }
}
