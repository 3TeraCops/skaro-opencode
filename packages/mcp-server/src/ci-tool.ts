import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export interface CiRunArgs {
  runId: number;
  kind: 'ci' | 'release';
  action: 'track' | 'status' | 'retry_failed';
}

export function ciRunTool(
  handler: (args: CiRunArgs, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'ci_run',
    description:
      'Track a real GitHub Actions CI or release run in this project. Skaro persists the run ID ' +
      'and continues observing it after the agent turn or app restart. Tracking retries startup_failure once; ' +
      'code/test failures remain errors with logs. Use retry_failed only when a retry is authorized and useful; ' +
      'fix code errors first. A merged task stays done if release CI fails. Never claim a release succeeded ' +
      'without checking the completed run and published artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'integer', minimum: 1 },
        kind: { type: 'string', enum: ['ci', 'release'] },
        action: { type: 'string', enum: ['track', 'status', 'retry_failed'] },
      },
      required: ['run_id', 'kind', 'action'],
      additionalProperties: false,
    },
    available: (scope) => !scope.importId,
    call: async (args, scope) => {
      if (
        !Number.isSafeInteger(args['run_id']) ||
        Number(args['run_id']) < 1 ||
        !['ci', 'release'].includes(String(args['kind'])) ||
        !['track', 'status', 'retry_failed'].includes(String(args['action']))
      )
        return {
          text: 'Provide a positive run_id, kind (ci/release) and action (track/status/retry_failed).',
          isError: true,
        };
      return handler(
        {
          runId: Number(args['run_id']),
          kind: args['kind'] as CiRunArgs['kind'],
          action: args['action'] as CiRunArgs['action'],
        },
        scope,
      );
    },
  };
}
