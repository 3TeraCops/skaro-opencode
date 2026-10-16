import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';
import {
  readVerificationPlan,
  verificationCheckSchema,
  type IntegrationCheck,
} from './verification-plan.ts';
export type { IntegrationCheck } from './verification-plan.ts';

export function verifyIntegrationTool(
  handler: (checks: IntegrationCheck[], scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'verify_integration',
    description:
      'Finish a staged conflict resolution and run the real build/affected behavior checks ' +
      'on this integration candidate. Skaro owns merge commits and verifies the exact SHA. Include ' +
      'checks for both input behaviors. Fix failures or further conflicts reported by the tool and ' +
      'call again. To repair a saved command, set replaces to its exact run string and preserve its name ' +
      'and behavior coverage. Set shell to powershell for PowerShell scripts; Windows defaults to cmd.exe. ' +
      'This does not itself publish to main.',
    inputSchema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          minItems: 1,
          items: verificationCheckSchema(true),
        },
      },
      required: ['checks'],
      additionalProperties: false,
    },
    available: (scope) => scope.kind === 'integration',
    call: async (args, scope) => {
      const checks = readVerificationPlan(args['checks'], true);
      if (scope.kind !== 'integration')
        return { text: 'Only an integration session can verify a candidate.', isError: true };
      if (typeof checks === 'string') return { text: checks, isError: true };
      return handler(checks, scope);
    },
  };
}
