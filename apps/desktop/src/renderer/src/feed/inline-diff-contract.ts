import type { FileRow } from '@skaro/timeline';
import type { DiffLine } from './diff-model';
import type { TextMetricsStyle } from './text-fonts';

export type InlineDiffRequest =
  | { type: 'open'; diffs: string[]; change: FileRow['change']; style: TextMetricsStyle }
  | { type: 'page'; id: number; start: number };
export type InlineDiffResponse =
  | { type: 'ready'; count: number }
  | { type: 'width'; width: number }
  | { type: 'page'; id: number; lines: DiffLine[] }
  | { type: 'error'; message: string };

/** Match the readonly text engine's long-line virtualization margin, without truncating data. */
export const windowedLineLength = 4000;
export type InlineTextView = (node: HTMLElement, text: string) => { destroy(): void };
