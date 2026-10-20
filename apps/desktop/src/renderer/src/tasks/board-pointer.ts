export function boardPointer(
  event: PointerEvent,
  actions: {
    start(rect: DOMRect, x: number, y: number): void;
    move(event: PointerEvent): void;
    finish(): void;
    cancel(): void;
  },
): () => void {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX,
    y = event.clientY;
  let started = false;
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, { capture: true });
  };
  const move = (next: PointerEvent) => {
    if (!started) {
      if (Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
      started = true;
      actions.start(rect, x, y);
    }
    actions.move(next);
  };
  const key = (next: KeyboardEvent) => {
    if (next.key !== 'Escape' || !started) return;
    next.preventDefault();
    next.stopPropagation();
    cancel();
  };
  const cancel = () => {
    stop();
    if (started) actions.cancel();
  };
  const up = () => {
    stop();
    if (!started) return;
    const swallow = (next: MouseEvent) => next.stopPropagation();
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    actions.finish();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, { capture: true });
  return cancel;
}
