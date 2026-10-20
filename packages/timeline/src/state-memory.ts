import type { Item } from './model.ts';
import type { TimelineState, TurnState } from './state.ts';

/** A logical retained-size estimate, not a measurement of the JavaScript heap. */
function sizeOf(value: unknown): number {
  if (typeof value === 'string') return 8 + value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (Array.isArray(value)) return 16 + value.reduce((sum, entry) => sum + sizeOf(entry), 0);
  if (value && typeof value === 'object')
    return 32 + Object.values(value).reduce<number>((sum, entry) => sum + sizeOf(entry), 0);
  return 0;
}

/** Completed history is weighed once; a live text delta accounts only its new characters. */
export class StateMemory {
  private readonly itemSizes = new Map<string, number>();
  private readonly turnSizes = new Map<string, number>();
  private items = 0;
  private turns = 0;
  private readonly state: TimelineState;
  constructor(state: TimelineState) {
    this.state = state;
  }
  get bytes(): number {
    const { items: _items, turns: _turns, ...header } = this.state;
    return sizeOf(header) + 32 + this.items + this.turns;
  }
  rebuild(): void {
    this.itemSizes.clear();
    this.turnSizes.clear();
    this.items = 0;
    this.turns = 0;
    for (const item of this.state.items) this.item(item);
    for (const turn of this.state.turns) this.turn(turn);
  }
  item(item: Item): void {
    const bytes = sizeOf(item);
    this.items += bytes - (this.itemSizes.get(item.id) ?? 0);
    this.itemSizes.set(item.id, bytes);
  }
  turn(turn: TurnState): void {
    const bytes = sizeOf(turn);
    this.turns += bytes - (this.turnSizes.get(turn.id) ?? 0);
    this.turnSizes.set(turn.id, bytes);
  }
  append(item: Item, chunk: string): void {
    const extra =
      chunk.length * 2 + Number(item.kind === 'reasoning' && item.text === undefined) * 8;
    this.items += extra;
    this.itemSizes.set(item.id, (this.itemSizes.get(item.id) ?? 0) + extra);
  }
}
