import type { AgentErrorCategory } from '@skaro/timeline';

/** Shared by the adapter's sessions; a successful login invalidates existing processes. */
export class CodexAuthRevision {
  private value = 0;
  private readonly shared?: Int32Array;

  constructor(buffer?: SharedArrayBuffer) {
    if (buffer) this.shared = new Int32Array(buffer);
  }

  get current(): number {
    return this.shared ? Atomics.load(this.shared, 0) : this.value;
  }

  signedIn(): void {
    if (this.shared) Atomics.add(this.shared, 0, 1);
    else this.value++;
  }
}

/** Tracks the credentials loaded by one process without holding or inspecting tokens. */
export class CodexSessionAuth {
  private loadedRevision: number | undefined;
  private rejected = false;
  private readonly revision: CodexAuthRevision | undefined;

  constructor(revision?: CodexAuthRevision) {
    this.revision = revision;
  }

  get current(): number {
    return this.revision?.current ?? 0;
  }

  get stale(): boolean {
    return this.rejected || this.loadedRevision !== this.current;
  }

  loaded(revision: number): void {
    this.loadedRevision = revision;
    this.rejected = false;
  }

  failed(category: AgentErrorCategory | undefined): void {
    if (category === 'auth') this.rejected = true;
  }
}
