import type { ChildProcess } from 'node:child_process';

/** SDK close requests termination; a handoff also needs proof that its processes exited. */
export class SessionProcesses {
  private readonly running = new Set<ChildProcess>();
  track(child: ChildProcess): void {
    this.running.add(child);
    child.once('close', () => this.running.delete(child));
    child.once('error', () => this.running.delete(child));
  }

  async stopped(): Promise<void> {
    await Promise.all(
      [...this.running].map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            const done = () => {
              clearTimeout(timer);
              child.off('close', done);
              resolve();
            };
            const timer = setTimeout(() => {
              child.off('close', done);
              reject(
                new Error('Claude Code did not stop. The working folder has not been handed over.'),
              );
            }, 10000);
            child.once('close', done);
            if (!this.running.has(child)) done();
          }),
      ),
    );
  }
}
