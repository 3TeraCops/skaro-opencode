import { EditorView } from '@codemirror/view';
import { readonlyTextView } from './readonly-text-view';

/** The surrounding fd-diff owns scrolling, width, sign, font and diff colors. */
const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'inherit',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      overflow: 'visible',
      height: 'auto',
    },
    '.cm-content': { padding: '0', minHeight: '0' },
    '.cm-line': { padding: '0' },
  },
  { dark: true },
);

export function inlineDiffText(node: HTMLElement, text: string) {
  return readonlyTextView(node, text, [theme]);
}
