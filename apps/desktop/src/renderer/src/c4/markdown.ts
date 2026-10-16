import { mount, unmount } from 'svelte';

/** Mount typed C4 attachments in sanitized Markdown; dispose on every text change. */
export function mountC4(root: HTMLElement): () => void {
  let disposed = false;
  const components: ReturnType<typeof mount>[] = [];
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-c4')];
  if (blocks.length)
    void import('./C4Attachments.svelte').then(({ default: Component }) => {
      if (disposed) return;
      for (const block of blocks)
        components.push(
          mount(Component, { target: block, props: { source: block.dataset['source'] ?? '' } }),
        );
    });
  return () => {
    disposed = true;
    components.forEach((component) => void unmount(component));
  };
}
