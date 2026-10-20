/** Paging must preserve native Tab traversal across rows that have not been mounted yet. */
export function windowedFocus(options: {
  root(): HTMLElement | undefined;
  count(): number;
  retain(index: number | undefined): void;
  reveal(index: number): Promise<void>;
}) {
  $effect(() => {
    const root = options.root();
    if (!root) return;
    const rowOf = (target: EventTarget | null) => {
      let element = target instanceof HTMLElement ? target : undefined;
      while (element?.parentElement && element.parentElement !== root)
        element = element.parentElement;
      return element?.parentElement === root && element.dataset['feedBlock'] !== undefined
        ? element
        : undefined;
    };
    const focus = (event: FocusEvent) => {
      const row = rowOf(event.target);
      if (row)
        queueMicrotask(() => {
          if (root.contains(document.activeElement))
            options.retain(Number(row.dataset['feedBlock']));
        });
    };
    const blur = () => {
      // Native blur may fire while Svelte removes a keyed row inside a derived render.
      // Publish focus retention after that render, never mutate reactive state inside it.
      queueMicrotask(() => {
        if (!root.contains(document.activeElement) && !root.querySelector('[aria-expanded="true"]'))
          options.retain(undefined);
      });
    };
    const focusable = (row: HTMLElement) =>
      [
        ...row.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const row = rowOf(event.target);
      if (!row) return;
      const targets = focusable(row);
      const boundary = event.shiftKey ? targets[0] : targets.at(-1);
      if (event.target !== boundary) return;
      const direction = event.shiftKey ? -1 : 1;
      const next = Number(row.dataset['feedBlock']) + direction;
      if (next < 0 || next >= options.count()) return;
      const pick = (element: HTMLElement | null) => {
        const targets = element ? focusable(element) : [];
        return event.shiftKey ? targets.at(-1) : targets[0];
      };
      const immediate = root.querySelector<HTMLElement>(`[data-feed-block="${next}"]`);
      if (pick(immediate)) return;
      event.preventDefault();
      const original = event.target;
      void (async () => {
        for (let index = next; index >= 0 && index < options.count(); index += direction) {
          await options.reveal(index);
          if (
            !root.isConnected ||
            (document.activeElement !== original && document.activeElement !== document.body)
          )
            return;
          const target = pick(root.querySelector<HTMLElement>(`[data-feed-block="${index}"]`));
          if (target) {
            target.focus();
            return;
          }
        }
        // Headers and text-only document blocks do not become a Tab stop.
        const outside = focusable(document.body).filter(
          (element) =>
            !root.contains(element) &&
            !!(
              root.compareDocumentPosition(element) &
              (event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)
            ),
        );
        (event.shiftKey ? outside.at(-1) : outside[0])?.focus();
      })();
    };
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    root.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', blur);
      root.removeEventListener('keydown', key);
    };
  });
}
