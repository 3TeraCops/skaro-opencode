import { createWriteStream, type WriteStream } from 'node:fs';
import type { RawLine } from '@skaro/timeline';

/** Node's ordered asynchronous stream keeps filesystem writes off Electron's main thread. */
export class IntegrationRawLog {
  private readonly stream: WriteStream;
  private error?: Error;
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: 'a' });
    this.stream.on('error', (error) => {
      this.error = error;
    });
  }
  append(line: RawLine | Uint8Array): void {
    if (this.error) throw this.error;
    this.stream.write(line instanceof Uint8Array ? line : JSON.stringify(line) + '\n');
  }
  drain(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.stream.write('', (error) => (error ? reject(error) : resolve()));
    });
  }
  async close(): Promise<void> {
    await this.drain();
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
