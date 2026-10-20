import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Resolve the real built worker in bundled main and source-level test runners. */
export function backgroundWorkerEntry(): string {
  const bundled = join(__dirname, 'background-worker.js');
  if (existsSync(bundled)) return bundled;
  const built = join(__dirname, '../../../out/main/background-worker.js');
  if (existsSync(built)) return built;
  throw new Error('The background worker is not built. Build the desktop application first.');
}
