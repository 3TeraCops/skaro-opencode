import { Compartment } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { commandOutputTheme } from './command-output-theme';
import { outputWidth } from './output-width';
import { readonlyTextView } from './readonly-text-view';

class OutputCursor extends WidgetType {
  toDOM(): HTMLElement {
    const node = document.createElement('span');
    node.className = 'fd-cursor';
    return node;
  }
}
export interface CommandOutputOptions {
  output: string;
  full: boolean;
  cursor: boolean;
}

/** CodeMirror handles both row and long-line gaps, Unicode and selection across invisible text. */
export function createCommandOutput(node: HTMLElement, onerror: (message: string) => void) {
  const cursor = new Compartment();
  const textView = readonlyTextView(node, '', [commandOutputTheme, cursor.of([])]);
  const { view } = textView;
  view.scrollDOM.classList.add('fd-output');
  const width = outputWidth(view.scrollDOM, view.contentDOM, onerror);
  let text = '';
  let hasCursor = false;
  return {
    update(options: CommandOutputOptions) {
      view.scrollDOM.classList.toggle('full', options.full);
      if (options.output === text && options.cursor === hasCursor) return;
      const append = options.output.startsWith(text);
      const from = append ? view.state.doc.length : 0;
      const insert = view.state.toText(append ? options.output.slice(text.length) : options.output);
      const end = from + insert.length;
      view.dispatch({
        changes: { from, to: view.state.doc.length, insert },
        effects: cursor.reconfigure(
          options.cursor
            ? EditorView.decorations.of(
                Decoration.set([
                  Decoration.widget({ widget: new OutputCursor(), side: 1 }).range(end),
                ]),
              )
            : [],
        ),
      });
      if (text !== options.output) width.update(options.output);
      text = options.output;
      hasCursor = options.cursor;
    },
    destroy: () => {
      width.destroy();
      textView.destroy();
    },
  };
}
export type CommandOutputView = ReturnType<typeof createCommandOutput>;
