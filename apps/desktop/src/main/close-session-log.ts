import type { WriteStream } from 'node:fs';

/** Preserve queued native records before quitting; stream.end() alone does not await their writes. */
export async function closeSessionLog(log: WriteStream | undefined): Promise<void> {
  if (!log || log.closed) return;
  await new Promise<void>((resolve, reject) => {
    log.once('error', reject);
    log.end(() => {
      log.removeListener('error', reject);
      resolve();
    });
  });
}
