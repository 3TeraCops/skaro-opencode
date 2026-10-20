import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseAgentMarkdown, parseAgentMarkdownParts } from '../renderer/src/feed/markdown-parse';

it('keeps the existing Markdown rendering of actual repository documents when partitioned', async () => {
  for (const path of ['agent-output.md', 'architecture.md', 'ui-baseline.md']) {
    const file = fileURLToPath(new URL(`../../../../docs/${path}`, import.meta.url));
    const text = await readFile(file, 'utf8');
    const parts = parseAgentMarkdownParts(text);
    expect(parts.join('')).toBe(parseAgentMarkdown(text));
    expect(parts.length).toBeGreaterThan(1);
  }
});
