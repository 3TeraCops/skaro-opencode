interface Source {
  root(): HTMLElement | undefined;
  blocks(): { id: string }[];
  position?(id: string): number;
  enabled(): boolean;
  track?(): boolean;
  text(): string;
  copyAll?: () => Promise<void> | undefined;
}
/** Browser selection stays native; select-all/copy includes the complete virtual conversation. */
export class FeedSelection {
  range = $state<{ start: number; end: number }>();
  private all = false;
  constructor(source: Source) {
    $effect(() => {
      const root = source.root();
      if (!root || !(source.track?.() ?? source.enabled())) return;
      const selecting = () => {
        const selection = getSelection();
        if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode)) {
          this.all = false;
          this.range = undefined;
          return;
        }
        const index = (node: Node | null) => {
          let element = node instanceof HTMLElement ? node : node?.parentElement;
          while (element?.parentElement && element.parentElement !== root)
            element = element.parentElement;
          const id = element?.dataset['feedBlock'];
          return id
            ? (source.position?.(id) ?? source.blocks().findIndex((block) => block.id === id))
            : -1;
        };
        const anchor = index(selection.anchorNode),
          focus = index(selection.focusNode);
        if (anchor >= 0 && focus >= 0)
          this.range = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) + 1 };
      };
      const selectAll = (event: KeyboardEvent) => {
        if (
          !source.enabled() ||
          !(event.ctrlKey || event.metaKey) ||
          event.key.toLowerCase() !== 'a'
        )
          return;
        if ((event.target as Element)?.closest('input,textarea,[contenteditable="true"]')) return;
        const dialogs = document.querySelectorAll('[role="dialog"]');
        const dialog = dialogs[dialogs.length - 1];
        if (dialog && !dialog.contains(root)) return;
        event.preventDefault();
        this.all = true;
        getSelection()?.selectAllChildren(root);
      };
      const copy = (event: ClipboardEvent) => {
        if (!source.enabled() || !this.all) return;
        event.preventDefault();
        const copying = source.copyAll?.();
        if (copying) void copying.catch((error: unknown) => console.error('Copy:', error));
        else event.clipboardData?.setData('text/plain', source.text());
      };
      const pointer = () => {
        this.all = false;
      };
      document.addEventListener('selectionchange', selecting);
      document.addEventListener('keydown', selectAll);
      document.addEventListener('copy', copy);
      document.addEventListener('pointerdown', pointer);
      return () => {
        document.removeEventListener('selectionchange', selecting);
        document.removeEventListener('keydown', selectAll);
        document.removeEventListener('copy', copy);
        document.removeEventListener('pointerdown', pointer);
      };
    });
  }
}
