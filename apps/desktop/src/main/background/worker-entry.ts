import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolve the real built worker both in packaged code and source-level Node callers. */
export function backgroundWorkerEntry(): string {
  const bundled = fileURLToPath(new URL('./background-worker.js', import.meta.url));
  if (existsSync(bundled)) return bundled;
  const built = fileURLToPath(new URL('../../../out/main/background-worker.js', import.meta.url));
  if (existsSync(built)) return built;
  throw new Error('The background worker is not built. Build the desktop application first.');
}
