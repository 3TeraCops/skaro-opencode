import { join } from 'node:path';
import type { RunRecord } from '@skaro/core';
import {
  continuationTimeline,
  countSegments,
  replayRunLog,
  runEvent,
  Timeline,
} from '@skaro/timeline';
import type { TaskRunDeps } from './task-run-model';
import { projectorFor, readRunLog } from './session-log';

/** Follow explicit predecessors only: unrelated historical runs are not part of this chat. */
export async function loadTaskHistory(deps: TaskRunDeps, run: RunRecord) {
  const chain: RunRecord[] = [];
  const seen = new Set<string>();
  let cursor: RunRecord | undefined = run;
  while (cursor) {
    if (seen.has(cursor.id)) throw new Error('Cyclic task run history');
    if (cursor.projectId !== run.projectId || cursor.taskId !== run.taskId)
      throw new Error('The predecessor belongs to another task');
    seen.add(cursor.id);
    chain.unshift(cursor);
    const previous: string | undefined = cursor.previousRunId;
    cursor = previous ? deps.db.getRun(previous) : undefined;
    if (previous && !cursor) throw new Error('The predecessor run is missing');
  }
  let timeline = new Timeline();
  let seq = 0;
  let segments = 0;
  for (const entry of chain) {
    if (entry.previousRunId) timeline = continuationTimeline(timeline.state);
    const lines = await readRunLog(
      join(deps.dataDir, entry.logPath),
      entry.id !== run.id || !!entry.nativeSessionId,
    );
    const events = replayRunLog(
      lines,
      entry.startedAt,
      projectorFor(entry.agent),
      (image) => deps.attachments.save(image),
      (event) => (entry.previousRunId ? runEvent(event, entry.id) : event),
    );
    for (const event of events) timeline.apply(event);
    seq += events.length;
    segments = countSegments(lines);
  }
  return { timeline, seq, segments };
}
