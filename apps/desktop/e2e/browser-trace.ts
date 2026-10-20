import type { CDPSession } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

/** Optional real-browser trace for separating script, layout and paint stalls. */
export async function browserTrace(session: CDPSession, path: string) {
  if (!process.env['SKARO_PERF_TRACE']) return undefined;
  await session.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink,blink.user_timing',
    transferMode: 'ReturnAsStream',
  });
  return async () => {
    const completion = new Promise<{ stream?: string }>((resolve) =>
      session.once('Tracing.tracingComplete', resolve),
    );
    await session.send('Tracing.end');
    const { stream } = await completion;
    if (!stream) throw new Error('Browser tracing returned no stream');
    const parts: Buffer[] = [];
    for (;;) {
      const result = await session.send('IO.read', { handle: stream });
      parts.push(Buffer.from(result.data as string, result.base64Encoded ? 'base64' : 'utf8'));
      if (result.eof) break;
    }
    await session.send('IO.close', { handle: stream });
    await writeFile(path, Buffer.concat(parts));
  };
}
