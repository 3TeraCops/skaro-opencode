// Replay of an OpenCode run log. Item events are written by Skaro as meta lines; the projector
// rebuilds only the turn boundaries from the native execution events, so streamed text is never
// applied twice.

import { obj, str, type Emit, type Projector } from '@skaro/timeline';

export class OpenCodeProjector implements Projector {
  private turns = 0;
  private active: string | undefined;
  private readonly emit: Emit;

  constructor(emit: Emit) {
    this.emit = emit;
  }

  input(_line: unknown): void {}

  output(line: unknown): void {
    const event = obj(line);
    const type = str(event?.['type']);
    if (!type) return;
    switch (type) {
      case 'session.execution.started':
        if (!this.active) {
          this.active = `turn-${++this.turns}`;
          this.emit({ t: 'turn.started', turnId: this.active });
        }
        break;
      case 'session.execution.succeeded':
        this.finish('done');
        break;
      case 'session.execution.interrupted':
        this.finish('interrupted');
        break;
      case 'session.execution.failed': {
        const error = obj(obj(event?.['data'])?.['error']);
        const message = str(error?.['message']) ?? 'OpenCode failed';
        this.finish('failed', { category: 'other', message });
        break;
      }
      case 'session.idle':
        this.finish('done');
        break;
      default:
        break;
    }
  }

  private finish(
    outcome: 'done' | 'interrupted' | 'failed',
    error?: { category: 'other'; message: string },
  ): void {
    const turnId = this.active;
    this.active = undefined;
    if (!turnId) return;
    this.emit({
      t: 'turn.completed',
      turnId,
      outcome,
      ...(error ? { error } : {}),
    });
  }
}
