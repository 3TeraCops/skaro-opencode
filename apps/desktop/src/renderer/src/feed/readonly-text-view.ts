import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { textSelectionCopy } from './text-selection-copy';

/** A complete readonly text model with viewport/long-line gaps and no additional Tab stop. */
export function readonlyTextView(parent: HTMLElement, doc: string, extensions: Extension[]) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.tabSize.of(8),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-readonly': 'true' }),
        ...extensions,
      ],
    }),
  });
  const releaseCopy = textSelectionCopy(view);
  return {
    view,
    destroy: () => {
      releaseCopy();
      view.destroy();
    },
  };
}
