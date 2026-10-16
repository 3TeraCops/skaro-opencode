import type { Emit, ProjectionContext } from '@skaro/timeline';
import { project } from '@skaro/timeline/tolerance';
import { expect, it } from 'vitest';
import { ClaudeProjector } from './projector.ts';

const factory = (ctx: ProjectionContext, emit: Emit) => new ClaudeProjector(ctx, emit);

it('reports broken servers of the session but not unsigned claude.ai account connectors', () => {
  const events = project(factory, [
    {
      dir: 'out',
      line: {
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        model: 'claude-opus-5-5',
        mcp_servers: [
          { name: 'claude.ai Google Drive', status: 'needs-auth' },
          { name: 'skaro', status: 'failed' },
          { name: 'project-docs', status: 'needs-auth' },
          { name: 'playwright', status: 'connected' },
        ],
      },
    },
  ]);
  const notices = events.flatMap((e) =>
    e.t === 'item.upsert' && e.item.kind === 'notice' ? [e.item.text] : [],
  );
  expect(notices).toEqual(['skaro: failed', 'project-docs: needs-auth']);
});
