import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import { Timeline, type TimelineEvent, type TimelineState } from '@skaro/timeline';
import { replayHistory } from '../src/main/background/history-replay';
import { assertLiveProfileBoundary } from './live-profile-boundary';

export interface ControlSample {
  before: TimelineState;
  event: TimelineEvent;
  next?: TimelineEvent;
}

/** Only actual recorded streams from the explicitly isolated project; no generated events. */
export async function recordedControlSamples(profile: string, project: string) {
  assertLiveProfileBoundary(profile);
  const db = new DatabaseSync(join(profile, 'skaro.db'), { readOnly: true });
  let chats;
  try {
    chats = db
      .prepare(
        'SELECT log_path,created_at,agent FROM chats WHERE project_id=? AND native_session_id IS NOT NULL',
      )
      .all(project);
  } finally {
    db.close();
  }
  const samples = new Map<string, ControlSample>();
  const streams: TimelineEvent[][] = [];
  let events = 0;
  for (const chat of chats) {
    const timeline = new Timeline();
    const stream: TimelineEvent[] = [];
    streams.push(stream);
    let previous: ControlSample | undefined;
    await replayHistory(
      join(profile, String(chat['log_path'])),
      Number(chat['created_at']),
      String(chat['agent']),
      new AttachmentStore(join(profile, 'attachments')).context(),
      (event) => {
        events++;
        stream.push(structuredClone(event));
        if (previous) previous.next = structuredClone(event);
        previous = undefined;
        if (
          ['session.started', 'plan.updated', 'usage', 'limits', 'activity', 'status'].includes(
            event.t,
          )
        ) {
          const key = `${event.t}:${timeline.state.interactions.some((i) => i.kind === 'question')}:${timeline.state.items.length > 0}`;
          if (!samples.has(key)) {
            previous = { before: structuredClone(timeline.state), event: structuredClone(event) };
            samples.set(key, previous);
          }
        }
        timeline.apply(event);
      },
    );
  }
  return { samples: [...samples.values()], streams, events, chats: chats.length };
}
