import { EditorView } from '@codemirror/view';

/** Match fd-output; no editor chrome, gutter, caret, commands or new Tab stop. */
export const commandOutputTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      fontFamily: 'var(--sk-mono)',
      fontSize: 'var(--sk-fs-4)',
      lineHeight: '1.5',
      color: 'var(--sk-text-13)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      height: 'auto',
    },
    '.cm-content': { padding: '0', minHeight: '0' },
    '.cm-line': { padding: '0' },
  },
  { dark: true },
);
