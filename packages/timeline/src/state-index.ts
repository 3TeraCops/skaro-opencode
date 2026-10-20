import type { Item } from './model.ts';
import type { TimelineState, TurnState } from './state.ts';

/** Mutable indexes belong to the command model; completing a turn visits its live items only. */
export class StateIndex {
  readonly items = new Map<string, number>();
  private readonly turns = new Map<string, TurnState>();
  private readonly live = new Map<string, Set<string>>();
  private readonly open = new Set<string>();
  private readonly running = new Set<string>();
  private readonly state: TimelineState;
  constructor(state: TimelineState) {
    this.state = state;
  }
  rebuild(): void {
    this.items.clear();
    this.turns.clear();
    this.live.clear();
    this.open.clear();
    this.running.clear();
    for (const turn of this.state.turns) this.rememberTurn(turn);
    this.state.items.forEach((item, at) => this.rememberItem(item, at));
  }
  turn(id: string): TurnState {
    let turn = this.turns.get(id);
    if (!turn) {
      turn = { id };
      this.state.turns.push(turn);
      this.rememberTurn(turn);
    }
    return turn;
  }
  private rememberTurn(turn: TurnState): void {
    this.turns.set(turn.id, turn);
    if (!turn.outcome) this.open.add(turn.id);
  }
  complete(id: string): void {
    this.open.delete(id);
  }
  get working(): boolean {
    return this.open.size > 0;
  }
  get busy(): boolean {
    return this.running.size > 0;
  }
  rememberItem(item: Item, at: number): void {
    this.running.delete(item.id);
    if (
      item.status === 'running' ||
      (item.kind === 'command' && item.background?.state === 'running')
    )
      this.running.add(item.id);
    const oldAt = this.items.get(item.id);
    const old = oldAt === undefined ? undefined : this.state.items[oldAt];
    if (old) {
      const previous = this.live.get(old.turnId);
      previous?.delete(old.id);
      if (!previous?.size) this.live.delete(old.turnId);
    }
    this.items.set(item.id, at);
    if (
      item.status === 'running' &&
      (item.kind === 'reasoning' || (item.kind === 'message' && item.role === 'agent'))
    ) {
      let pending = this.live.get(item.turnId);
      if (!pending) this.live.set(item.turnId, (pending = new Set()));
      pending.add(item.id);
    }
  }
  liveItems(turn: string): string[] {
    return [...(this.live.get(turn) ?? [])];
  }
  clearLive(turn: string): void {
    this.live.delete(turn);
  }
}
