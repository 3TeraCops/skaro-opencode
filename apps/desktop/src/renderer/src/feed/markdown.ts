// Agent text: Markdown → sanitized HTML (architecture.md 10). Code gets highlighted, paths in
// `code` become file links when the file exists, remote images wait for a click.

import { htmlSanitizer, fragmentSanitizer } from '../sanitize';
const PURIFY = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'span',
    'div',
    'button',
    'input',
  ],
  ALLOWED_ATTR: [
    'href',
    'class',
    'data-path',
    'data-src',
    'data-alt',
    'data-source',
    'data-copy',
    'data-external',
    'data-tip',
    'type',
    'checked',
    'disabled',
    'aria-label',
    'align',
  ],
  ALLOW_DATA_ATTR: false,
};

const sanitizeHtml = htmlSanitizer(PURIFY);
export const markdownFragment = fragmentSanitizer(PURIFY);
const sanitizeSvg = htmlSanitizer({ USE_PROFILES: { svg: true, svgFilters: true } });
/** Markdown of an agent message as safe HTML. */
export function sanitizeMarkdown(html: string): string {
  return sanitizeHtml(html);
}

let mermaid: Promise<typeof import('mermaid').default> | undefined;
let mermaidSeq = 0;

/** Draws Mermaid blocks inside `root` (the library loads on first use). */
export async function drawMermaid(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-mermaid:not([data-done])')];
  if (!blocks.length) return;
  mermaid ??= import('mermaid').then((m) => {
    // Mermaid derives shades from real colors, so it gets the token values, not var().
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string): string => styles.getPropertyValue(name).trim();
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
      // SVG text labels: HTML labels would need foreignObject, which sanitizing drops.
      htmlLabels: false,
      fontFamily: 'Nunito Sans Variable, sans-serif',
      themeVariables: {
        background: token('--sk-surface'),
        primaryColor: token('--sk-surface-2'),
        primaryTextColor: token('--sk-diagram-text'),
        primaryBorderColor: token('--sk-surface-2'),
        lineColor: token('--sk-text-25'),
        fontSize: token('--sk-fs-4'),
      },
    });
    return m.default;
  });
  const lib = await mermaid;
  for (const block of blocks) {
    block.dataset['done'] = '1';
    try {
      const { svg } = await lib.render(`sk-mermaid-${++mermaidSeq}`, block.dataset['source'] ?? '');
      block.innerHTML = sanitizeSvg(svg);
    } catch {
      block.classList.add('md-mermaid-error');
      block.textContent = block.dataset['source'] ?? '';
    }
  }
}
