import type { AgentErrorCategory } from '@skaro/timeline';

/** Shared by the adapter's sessions; a successful login invalidates existing processes. */
export class CodexAuthRevision {
  private value = 0;

  get current(): number {
    return this.value;
  }

  signedIn(): void {
    this.value++;
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
