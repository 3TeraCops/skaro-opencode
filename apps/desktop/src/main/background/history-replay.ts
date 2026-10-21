import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { ClaudeProjector } from '@skaro/adapter-claude/projector';
import { CodexProjector } from '@skaro/adapter-codex/projector';
import { OpenCodeProjector } from '@skaro/adapter-opencode';
import {
  isRunLogMeta,
  segmentTurns,
  type Projector,
  type TimelineEvent,
  type RawLine,
  type ProjectionContext,
} from '@skaro/timeline';

/** Stream the recorded native protocol through the same projectors as a live agent. */
export async function replayHistory(
  path: string,
  startedAt: number,
  agent: string,
  attachments: Pick<ProjectionContext, 'attachImage'>,
  saved: (event: TimelineEvent) => void,
): Promise<number> {
  let now = startedAt;
  let segment = -1;
  let segments = 0;
  const context = { now: () => now, attachImage: attachments.attachImage };
  const emit = (event: TimelineEvent) => saved(segmentTurns(segment, event));
  const create = (): Projector =>
    agent === 'opencode'
      ? new OpenCodeProjector(emit)
      : agent === 'codex'
        ? new CodexProjector(context, emit)
        : new ClaudeProjector(context, emit);
  let projector: Projector | undefined;
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      if (!text.trim()) continue;
      let raw: RawLine;
      try {
        raw = JSON.parse(text) as RawLine;
      } catch {
        continue;
      }
      now = startedAt + raw.ts;
      if (raw.dir === 'meta' && isRunLogMeta(raw.line)) {
        if (raw.line.skaro === 'segment') {
          segment++;
          segments++;
          projector = create();
        } else if (raw.line.skaro === 'event') {
          // Saved events already contain scoped turn ids.
          saved(raw.line.event);
        }
      } else {
        projector ??= create();
        if (raw.dir === 'in') projector.input(raw.line);
        else if (raw.dir === 'out') projector.output(raw.line);
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return segments;
}
