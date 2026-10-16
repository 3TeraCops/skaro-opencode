import { Timeline, type Emit, type ProjectionContext } from '@skaro/timeline';
import { project } from '@skaro/timeline/tolerance';
import { expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

const factory = (ctx: ProjectionContext, emit: Emit) => new ClaudeProjector(ctx, emit);

const stream = (event: object) => ({ dir: 'out' as const, line: { type: 'stream_event', event } });
const thinking = (id: string) => [
  stream({ type: 'message_start', message: { id } }),
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
  stream({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'a' },
  }),
];

it('ends the reasoning of a dropped stream: the retry comes as a new message', () => {
  const events = project(factory, [
    // Dropped without a word: the retry's message_start ends it.
    ...thinking('msg_1'),
    { dir: 'out', line: { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10 } },
    // Dropped with the stream closed, still without the final assistant message.
    ...thinking('msg_2'),
    stream({ type: 'content_block_stop', index: 0 }),
    stream({ type: 'message_stop' }),
    { dir: 'out', line: { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10 } },
    ...thinking('msg_3'),
  ]);
  const reasoning = Timeline.from(events).state.items.filter((i) => i.kind === 'reasoning');
  expect(reasoning.map((i) => [i.id, i.status])).toEqual([
    ['msg_1-0', 'done'],
    ['msg_2-0', 'done'],
    ['msg_3-0', 'running'],
  ]);
});
