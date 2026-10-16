import type { RunRecord } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';

export interface HandoffRecord {
  context: string;
  mergeSummary?: string;
  commitMessage?: string;
  inputs: MessageInput[];
}

export function handoffRecord(run: RunRecord): HandoffRecord | undefined {
  return run.handoff ? (JSON.parse(run.handoff) as HandoffRecord) : undefined;
}
