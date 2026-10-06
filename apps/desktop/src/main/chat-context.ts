import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { LiveChat } from './chat-model';
import { projectContextText } from './chat-context-text';

import type { ChatEngine } from './chat-engine';
import { CompletionStore } from './completion-store';
import type { TrackedCiRun } from './ci-runs';

export class ChatContext {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── MCP tools of the chat agent ──────────────────────────────────────────

  async context(scope: SkaroScope): Promise<ToolResult> {
    const context = this.ctx.project(scope.projectId);
    const artifacts = await context.load();
    const name = this.ctx.deps.db.getProject(scope.projectId)?.name ?? '';
    return {
      text:
        projectContextText(name, artifacts, this.ctx.deps.db.getTaskRuntime(scope.projectId)) +
        '\n\n## Merge blockers\n' +
        JSON.stringify(new CompletionStore(this.ctx.deps.db, scope.projectId).issues()) +
        '\n\n## Merge operations\n' +
        JSON.stringify(
          new CompletionStore(this.ctx.deps.db, scope.projectId)
            .operations()
            .slice(-20)
            .map(({ id, state, base, commit, error, results }) => ({
              id,
              state,
              base,
              commit,
              error,
              tasks: results.map((result) => result.taskId),
            })),
        ) +
        '\n\n## CI and release runs\n' +
        JSON.stringify(
          this.ctx.deps.db
            .getSetting<TrackedCiRun[]>('ci.runs', [])
            .filter((run) => run.projectId === scope.projectId)
            .map(({ repository, runId, kind, remote, error }) => ({
              repository,
              runId,
              kind,
              remote,
              error,
            })),
        ),
    };
  }

  /** The chat whose agent is calling; its grant must be the live one. */
  caller(scope: SkaroScope): LiveChat {
    const live = scope.chatId ? this.ctx.live.get(scope.chatId) : undefined;
    if (!live || live.projectId !== scope.projectId || !live.session) {
      throw new Error('This chat session is no longer active.');
    }
    return live;
  }
}
