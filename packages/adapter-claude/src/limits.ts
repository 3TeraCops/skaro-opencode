import { query } from '@anthropic-ai/claude-agent-sdk';
import { limitWindow, obj, type AgentLimits } from '@skaro/timeline';

/** The experimental SDK contract is contained here, never exposed to the renderer. */
export function claudeLimits(value: unknown): AgentLimits {
  const data = obj(value);
  const limits = data?.['rate_limits_available'] === true ? obj(data['rate_limits']) : undefined;
  return {
    checkedAt: new Date().toISOString(),
    windows: (['five_hour', 'seven_day'] as const).flatMap((kind) => {
      const window = obj(limits?.[kind]);
      return window ? [limitWindow(kind, window['utilization'], window['resets_at'])] : [];
    }),
  };
}

export async function readClaudeLimits(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentLimits> {
  const prompt: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
  };
  const q = query({ prompt, options: { cwd, env, pathToClaudeCodeExecutable: executable } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      await q.initializationResult();
      return claudeLimits(
        await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      );
    };
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Claude usage request timed out')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    q.close();
  }
}
