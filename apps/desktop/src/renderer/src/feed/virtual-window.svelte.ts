/** Fenwick sums let viewport changes address variable-height rows without scanning the history. */
export class VirtualWindow {
  private readonly gap: number;
  private readonly estimate: number;
  constructor(gap = 14, estimate = 100) {
    this.gap = gap;
    this.estimate = estimate;
  }
  start = $state(0);
  end = $state(0);
  top = $state(0);
  bottom = $state(0);
  private revision = $state(0);
  private ids: string[] = [];
  // Height invalidation is tracked once by revision, independently of row effects.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly measured = new Map<string, number>();
  private tree = new Float64Array(1);
  private heights: number[] = [];
  private offset = 0;
  private viewport = 800;
  reset(ids: string[]): void {
    if (ids.length === this.ids.length && ids.every((id, i) => id === this.ids[i])) return;
    this.ids = ids;
    this.heights = ids.map((id) => (this.measured.get(id) ?? this.estimate) + this.gap);
    this.tree = new Float64Array(ids.length + 1);
    this.heights.forEach((height, i) => this.add(i, height));
    this.revision++;
    this.update(this.offset, this.viewport);
  }
  measure(id: string, index: number, height: number): void {
    if (this.ids[index] !== id || height < 1) return;
    this.measured.set(id, height);
    const delta = height + this.gap - this.heights[index]!;
    if (Math.abs(delta) < 0.5) return;
    this.heights[index] = height + this.gap;
    this.add(index, delta);
    this.revision++;
    this.update(this.offset, this.viewport);
  }
  update(offset: number, viewport: number): void {
    this.offset = Math.max(0, offset);
    this.viewport = viewport;
    const start = this.locate(Math.max(0, offset - 1200));
    const end = Math.min(this.ids.length, this.locate(offset + viewport + 1200) + 1);
    this.start = start;
    this.end = end;
    this.top = start ? Math.max(0, this.sum(start) - this.gap) : 0;
    this.bottom =
      end < this.ids.length ? Math.max(0, this.sum(this.ids.length) - this.sum(end) - this.gap) : 0;
  }
  offsetOf(index: number): number {
    void this.revision;
    return this.sum(index);
  }
  private add(index: number, delta: number): void {
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i]! += delta;
  }
  private sum(end: number): number {
    let total = 0;
    for (let i = end; i > 0; i -= i & -i) total += this.tree[i]!;
    return total;
  }
  private locate(offset: number): number {
    let index = 0;
    let total = 0;
    for (
      let step = 2 ** Math.floor(Math.log2(Math.max(1, this.ids.length)));
      step;
      step = Math.floor(step / 2)
    ) {
      const next = index + step;
      if (next < this.tree.length && total + this.tree[next]! <= offset) {
        index = next;
        total += this.tree[next]!;
      }
    }
    return Math.min(index, Math.max(0, this.ids.length - 1));
  }
}
