type Measure = () => (() => void) | undefined;
const pending = new Set<Measure>();
let frame = 0;

/** All viewport geometry is read before any viewport writes, once per animation frame. */
export function layoutFrame(measure: Measure): () => void {
  pending.add(measure);
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      const batch = [...pending];
      pending.clear();
      const writes = batch.map((read) => read());
      for (const write of writes) write?.();
    });
  return () => {
    pending.delete(measure);
    if (!pending.size && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
