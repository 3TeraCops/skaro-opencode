/** Tracks the initial click until the real feed, queue or error replaces the start button. */
export class TaskStartState {
  private readonly state: { pending: boolean };
  constructor(state: { pending: boolean }) {
    this.state = state;
  }

  begin(): boolean {
    if (this.state.pending) return false;
    this.state.pending = true;
    return true;
  }

  update(status: { hasFeed: boolean; queued: boolean; error: boolean }): void {
    if (status.hasFeed || status.queued || status.error) this.cancel();
  }

  cancel(): void {
    this.state.pending = false;
  }
}
