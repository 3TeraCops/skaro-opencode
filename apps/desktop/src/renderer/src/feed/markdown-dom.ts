import { markdownFragment } from './markdown';

interface Part {
  html: string;
  nodes: ChildNode[];
  dispose(): void;
}

/** Keep unchanged DOM while streaming; sanitize/attach complete parts between input turns. */
export class MarkdownDom {
  private parts: Part[] = [];
  private generation = 0;
  private readonly root: HTMLElement;
  private readonly decorate: (fragment: DocumentFragment) => () => void;
  private readonly oncontent: () => void;

  constructor(
    root: HTMLElement,
    decorate: (fragment: DocumentFragment) => () => void,
    oncontent: () => void,
  ) {
    this.root = root;
    this.decorate = decorate;
    this.oncontent = oncontent;
  }

  async update(html: string[]): Promise<void> {
    const generation = ++this.generation;
    let same = 0;
    while (same < html.length && this.parts[same]?.html === html[same]) same++;
    if (same === html.length && same === this.parts.length) return;
    let started = performance.now();
    for (let index = same; index < html.length; index++) {
      if (generation !== this.generation) return;
      const fragment = markdownFragment(html[index]!);
      const nodes = [...fragment.childNodes];
      // Remove the changed tail only when its replacement is ready for attachment.
      if (index === same) this.removeFrom(same);
      const dispose = this.decorate(fragment);
      this.root.append(fragment);
      this.parts.push({ html: html[index]!, nodes, dispose });
      this.oncontent();
      if (performance.now() - started >= 4 && index + 1 < html.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        started = performance.now();
      }
    }
    if (generation === this.generation && html.length <= same) this.removeFrom(html.length);
  }

  private removeFrom(index: number): void {
    for (const part of this.parts.splice(index)) {
      part.dispose();
      for (const node of part.nodes) node.remove();
    }
  }

  cancel(): void {
    this.generation++;
  }

  destroy(): void {
    this.cancel();
    this.removeFrom(0);
  }
}
