import { diffCounts, numberedDiffLines, type NumberedLine } from './diff-model';
import { highlightDiff, type Segment } from './diff-highlight';
import type { FileChange } from '@skaro/timeline';

export interface DiffRequest {
  diffs: string[];
  change: FileChange['change'];
  path: string;
}
export interface DiffProjection {
  lines: NumberedLine[];
  width: number;
  counts: { added: number; removed: number };
}
export type DiffResult =
  | { type: 'lines'; value: DiffProjection }
  | { type: 'colors'; value: (Segment[] | undefined)[] | undefined }
  | { type: 'error'; message: string };

// A mounted viewer owns this worker. Closing it or switching files cancels all pending work.
self.onmessage = async (event: MessageEvent<DiffRequest>) => {
  try {
    const { diffs, change, path } = event.data;
    const lines = numberedDiffLines(diffs, change);
    const width = lines.reduce(
      (max, line) => Math.max(max, line.text.replace(/\t/g, '    ').length),
      0,
    );
    self.postMessage({
      type: 'lines',
      value: { lines, width, counts: diffCounts(lines) },
    } satisfies DiffResult);
    const value = await highlightDiff(path, lines);
    self.postMessage({ type: 'colors', value } satisfies DiffResult);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) } satisfies DiffResult);
  }
};
