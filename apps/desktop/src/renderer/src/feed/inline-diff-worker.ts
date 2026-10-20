import { fileDiffLines, type DiffLine } from './diff-model';
import { workerTextMetrics } from './text-fonts';
import type { InlineDiffRequest, InlineDiffResponse } from './inline-diff-contract';

let lines: DiffLine[] = [];
self.onmessage = async (event: MessageEvent<InlineDiffRequest>) => {
  try {
    const request = event.data;
    if (request.type === 'page') {
      self.postMessage({
        type: 'page',
        id: request.id,
        lines: lines.slice(request.start, request.start + 16),
      } satisfies InlineDiffResponse);
      return;
    }
    lines = fileDiffLines(request);
    self.postMessage({ type: 'ready', count: lines.length } satisfies InlineDiffResponse);
    const measure = await workerTextMetrics(request.style);
    let width = 0;
    let slice = performance.now();
    for (const line of lines) {
      width = Math.max(width, measure(line.text));
      // Page requests must remain serviceable while measuring the rest of the file.
      if (performance.now() - slice >= 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        slice = performance.now();
      }
    }
    self.postMessage({ type: 'width', width } satisfies InlineDiffResponse);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) } satisfies InlineDiffResponse);
  }
};
