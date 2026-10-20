import { htmlSanitizer } from '../sanitize';
import { parseDoc, inline as rawInline, type Block } from './parse';
export type { Block, Heading } from './parse';

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
    'input',
  ],
  ALLOWED_ATTR: ['href', 'data-href', 'type', 'checked', 'disabled', 'align'],
  ALLOW_DATA_ATTR: false,
};

const sanitize = htmlSanitizer(PURIFY);
export function inline(text: string): string {
  return sanitize(rawInline(text));
}
/** HTML is always sanitized at the renderer boundary, including pages from the parsing worker. */
export function sanitizeBlock(block: Block): Block {
  if (block.kind === 'html') return { ...block, html: sanitize(block.html) };
  if (block.kind === 'rules') return { ...block, items: block.items.map(sanitize) };
  return block;
}
export function renderDoc(source: string) {
  const parsed = parseDoc(source);
  return { ...parsed, blocks: parsed.blocks.map(sanitizeBlock) };
}
