import {
  C4_MODEL_SCHEMA,
  authoredBody,
  readC4Documents,
  c4Hash,
  git,
  type AppDb,
} from '@skaro/core';
import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import type { C4ProposalRecord } from './c4-service';
import { c4ChangeHash, c4ReviewKey } from './c4-review';

/** Send the model once, authored document text and durable proposal facts, without repeated preview payloads. */
export async function c4Context(
  context: ProjectContext,
  db: AppDb,
  records: C4ProposalRecord[],
  scope: SkaroScope,
  checkout: string,
): Promise<ToolResult> {
  context.invalidate();
  const artifacts = await context.load();
  const baseHead =
    scope.kind === 'task'
      ? (await git(checkout, ['rev-parse', artifacts.config.baseBranch])).stdout.trim()
      : undefined;
  return {
    text: JSON.stringify(
      {
        schema: C4_MODEL_SCHEMA,
        model: artifacts.c4 ?? null,
        problems: artifacts.c4Problems,
        documents: Object.fromEntries(
          [...(await readC4Documents(context.root))].map(([path, body]) => [
            path,
            authoredBody(body),
          ]),
        ),
        nextSpec: String(Math.max(0, ...artifacts.specs.map((s) => Number(s.id))) + 1).padStart(
          4,
          '0',
        ),
        nextAdr: String(Math.max(0, ...artifacts.adrs.map((s) => Number(s.id))) + 1).padStart(
          4,
          '0',
        ),
        packages: records.slice(-30).map(({ item, package: pkg }) => ({
          id: item.id,
          title: pkg.title,
          state: item.state,
          error: item.result?.error,
          baseRevision: pkg.baseRevision,
          files: pkg.files.map((f) => ({
            path: f.path,
            beforeHash: f.before === null ? null : c4Hash(f.before),
            afterHash: c4Hash(f.after),
            ...(['pending', 'accepted'].includes(item.state)
              ? { content: f.path.endsWith('.json') ? f.after : authoredBody(f.after) }
              : {}),
          })),
        })),
        ...(baseHead
          ? {
              task: {
                id: scope.taskId,
                checkout,
                baseHead,
                changeHash: await c4ChangeHash(checkout, baseHead),
                specification: artifacts.specs.find(
                  (s) => s.id === artifacts.tasks.find((t) => t.id === scope.taskId)?.spec,
                ),
                review: db.getSetting(c4ReviewKey(scope.projectId, scope.taskId!), null),
              },
            }
          : {}),
      },
      null,
      2,
    ),
  };
}
