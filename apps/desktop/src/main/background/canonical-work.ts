import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Timeline, runEvent, type TimelineEvent } from '@skaro/timeline';

/** Integration journals already contain canonical events; replay them without loading raw text. */
export async function canonicalWork(path: string, scope: string) {
  const timeline = new Timeline();
  let seq = 0;
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { timeline: timeline.state, seq };
    throw error;
  }
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      if (!text.trim()) continue;
      let event: TimelineEvent;
      try {
        event = JSON.parse(text) as TimelineEvent;
      } catch {
        continue;
      }
      timeline.apply(scope ? runEvent(event, scope) : event);
      seq++;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return { timeline: timeline.state, seq };
}
