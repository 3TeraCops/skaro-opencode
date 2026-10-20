import { parseDoc, type Block } from './parse';

let revision = 0;
let blocks: Block[] = [];
self.onmessage = (
  event: MessageEvent<{
    id: number;
    method: string;
    source?: string;
    revision?: number;
    start?: number;
  }>,
) => {
  const request = event.data;
  try {
    if (request.method === 'open') {
      const parsed = parseDoc(request.source ?? '');
      blocks = parsed.blocks;
      revision++;
      self.postMessage({
        id: request.id,
        value: { revision, count: blocks.length, headings: parsed.headings },
      });
    } else {
      if (request.revision !== revision) throw new Error('Document projection changed');
      const start = request.start ?? 0;
      self.postMessage({
        id: request.id,
        value: blocks
          .slice(start, start + 16)
          .map((block, index) => ({ ...block, id: String(start + index) })),
      });
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) });
  }
};
