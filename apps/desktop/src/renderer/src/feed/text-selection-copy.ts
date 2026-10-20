import type { EditorView } from '@codemirror/view';

const views = new Set<EditorView>();

/** Native text around a text view keeps its browser formatting; text gaps use the full model. */
function copy(event: ClipboardEvent) {
  if (event.defaultPrevented) return;
  const selection = getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const original = selection.getRangeAt(0).cloneRange();
  const included = [...views]
    .filter((view) => original.intersectsNode(view.contentDOM))
    .sort((a, b) =>
      a.contentDOM.compareDocumentPosition(b.contentDOM) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
  if (!included.length) return;
  const anchor = selection.anchorNode!,
    anchorOffset = selection.anchorOffset;
  const focus = selection.focusNode!,
    focusOffset = selection.focusOffset;
  let start = original.startContainer,
    offset = original.startOffset;
  const text: string[] = [];
  const native = (end: Node, endOffset: number) => {
    const range = document.createRange();
    range.setStart(start, offset);
    range.setEnd(end, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  };
  try {
    for (const view of included) {
      const content = view.contentDOM;
      const begins = content.contains(original.startContainer);
      const ends = content.contains(original.endContainer);
      if (!begins) text.push(native(content, 0));
      const from = begins ? view.posAtDOM(original.startContainer, original.startOffset) : 0;
      const to = ends
        ? view.posAtDOM(original.endContainer, original.endOffset)
        : view.state.doc.length;
      text.push(view.state.sliceDoc(from, to));
      start = ends ? original.endContainer : content;
      offset = ends ? original.endOffset : content.childNodes.length;
    }
    text.push(native(original.endContainer, original.endOffset));
    event.clipboardData?.setData('text/plain', text.join(''));
    event.preventDefault();
  } finally {
    selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  }
}

/** One document listener handles selection within, across and around mounted text views. */
export function textSelectionCopy(view: EditorView) {
  if (!views.size) document.addEventListener('copy', copy);
  views.add(view);
  return () => {
    views.delete(view);
    if (!views.size) document.removeEventListener('copy', copy);
  };
}
