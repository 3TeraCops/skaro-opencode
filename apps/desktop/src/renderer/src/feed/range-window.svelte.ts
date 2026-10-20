/** Sparse height corrections: memory follows measured rows, not the archive's row count. */
export class RangeWindow {
  readonly estimate: number;
  readonly gap: number;
  private readonly overscan: number;
  count = $state(0);
  start = $state(0);
  end = $state(0);
  visibleStart = $state(0);
  visibleEnd = $state(0);
  private revision = $state(0);
  // The revision publishes one completed index update, rather than every Fenwick node mutation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly heights = new Map<number, number>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly sums = new Map<number, number>();
  constructor(estimate = 180, gap = 14, overscan = 1000) {
    this.estimate = estimate;
    this.gap = gap;
    this.overscan = overscan;
  }
  reset(count: number, discard = false): void {
    if (this.count === count && !discard) return;
    if (discard) this.heights.clear();
    this.count = count;
    for (const index of this.heights.keys()) if (index >= count) this.heights.delete(index);
    this.sums.clear();
    for (const [index, height] of this.heights) this.add(index, height - this.estimate);
    this.revision++;
  }
  private add(index: number, delta: number): void {
    for (let at = index + 1; at <= this.count; at += at & -at) {
      const value = (this.sums.get(at) ?? 0) + delta;
      if (Math.abs(value) < 0.01) this.sums.delete(at);
      else this.sums.set(at, value);
    }
  }
  offset(index: number): number {
    void this.revision;
    let delta = 0;
    for (let at = index; at > 0; at -= at & -at) delta += this.sums.get(at) ?? 0;
    return index * (this.estimate + this.gap) + delta;
  }
  locate(offset: number): number {
    let low = 0,
      high = this.count;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (this.offset(middle) <= offset) low = middle;
      else high = middle - 1;
    }
    return Math.min(low, Math.max(0, this.count - 1));
  }
  update(offset: number, viewport: number): void {
    this.visibleStart = this.locate(Math.max(0, offset));
    this.visibleEnd = Math.min(this.count, this.locate(Math.max(0, offset) + viewport) + 1);
    this.start = this.locate(Math.max(0, offset - this.overscan));
    this.end = Math.min(
      this.count,
      this.locate(Math.max(0, offset) + viewport + this.overscan) + 1,
    );
  }
  measure(index: number, height: number): void {
    if (index >= this.count || height < 0) return;
    const old = this.heights.get(index) ?? this.estimate;
    if (Math.abs(old - height) < 0.5) return;
    this.heights.delete(index);
    this.heights.set(index, height);
    this.add(index, height - old);
    while (this.heights.size > 4096) {
      const oldest = this.heights.keys().next().value!;
      const previous = this.heights.get(oldest)!;
      this.heights.delete(oldest);
      this.add(oldest, this.estimate - previous);
    }
    this.revision++;
  }
}
