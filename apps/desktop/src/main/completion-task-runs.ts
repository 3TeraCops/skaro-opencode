import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import { McpHttpServer, type SkaroScope } from '@skaro/mcp-server';
import { AgentManager } from './agents';
import { TaskRuns } from './tasks';
import type { TaskRunDeps } from './task-run-model';
import type { CompletionFixture } from './completion-test-support';

/** Actual application services; no agent is downloaded/launched and MCP does not listen. */
export function completionTaskRuns(fixture: CompletionFixture): TaskRuns {
  return new TaskRuns(completionTaskDeps(fixture));
}

export function completionTaskDeps(fixture: CompletionFixture): TaskRunDeps {
  return {
    db: fixture.db,
    dataDir: fixture.root,
    projects: fixture.projects,
    agents: new AgentManager({
      agentsDir: join(fixture.root, 'agents'),
      scratchDir: join(fixture.root, 'scratch'),
      store: {
        getSetting: (key) => fixture.db.getSetting(key, null),
        setSetting: (key, value) => fixture.db.setSetting(key, value),
      },
      openUrl: () => undefined,
      onChange: () => undefined,
    }),
    attachments: new AttachmentStore(join(fixture.root, 'attachments')),
    mcp: new McpHttpServer<SkaroScope>({ name: 'skaro', version: 'test', tools: [] }),
    emit: () => undefined,
    locale: () => 'ru',
  };
}
