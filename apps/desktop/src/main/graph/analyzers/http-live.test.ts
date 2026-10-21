import { expect, test } from 'vitest';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { language } from '../source-policy';
import { Facts, hash } from '../facts';
import { analyzeTypescript } from './typescript';

const root = process.env.SKARO_GRAPH_VERIFY_ROOT;
test.skipIf(!root)(
  'real Chatballs common HTTP client preserves static request candidates',
  async () => {
    const paths = [
      'apps/internal-ui/src/api/client.ts',
      'apps/internal-ui/src/features/support-reports/api.ts',
    ];
    const files = await Promise.all(
      paths.map(async (path) => {
        const text = await readFile(join(root!, path), 'utf8');
        return { path, text, hash: hash(text), language: language(path) };
      }),
    );
    const facts = new Facts(hash(await realpath(root!)));
    files.forEach((file) => facts.file(file));
    const diagnostics: string[] = [];
    analyzeTypescript(root!, files, facts, (path, message) =>
      diagnostics.push(`${path}: ${message}`),
    );
    expect(diagnostics).toEqual([]);
    const requests = [...facts.nodes.values()].filter((node) => node.attributes.request === true);
    expect(
      requests.some((node) => node.attributes.path === '/api/v1/conversations/support-report/'),
    ).toBe(true);
    expect(
      requests.some((node) =>
        String(node.attributes.path).startsWith('/api/v1/organizations/{dynamic}/'),
      ),
    ).toBe(true);
    expect(requests.every((node) => node.sources[0]?.contentHash && node.sources[0].line)).toBe(
      true,
    );
    expect(
      [...facts.edges.values()].some(
        (edge) => edge.kind === 'calls' && edge.target.includes(':api:'),
      ),
    ).toBe(true);
  },
  30_000,
);
