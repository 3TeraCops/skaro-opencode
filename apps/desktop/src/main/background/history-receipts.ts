import { stat } from 'node:fs/promises';
import type { HistorySource, HistoryView } from '../../shared/history';
import { HISTORY_VERSION } from '../../shared/history';
import type { PayloadStore } from './payload-store';

/** Only fully recovered idle views can bypass command hydration on the next read-only open. */
export class HistoryReceipts {
  private readonly store: PayloadStore;
  constructor(store: PayloadStore) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS feed_receipts (
      owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,path TEXT NOT NULL,
      fingerprint TEXT NOT NULL,subject INTEGER NOT NULL)`);
  }
  private async fingerprint(path: string): Promise<string | undefined> {
    const file = await stat(path, { bigint: true }).catch(() => undefined);
    return file ? `${file.size}:${file.mtimeNs}:${file.ctimeNs}` : undefined;
  }
  async save(source: HistorySource, path: string, subject: number): Promise<void> {
    const fingerprint = await this.fingerprint(path);
    if (!fingerprint) return;
    const current = this.store.db
      .prepare('SELECT revision FROM feed_views WHERE owner=?')
      .get(source.owner);
    if (Number(current?.['revision']) !== source.revision) return;
    this.store.db
      .prepare(
        `INSERT INTO feed_receipts VALUES (?,?,?,?,?) ON CONFLICT(owner)
      DO UPDATE SET revision=excluded.revision,path=excluded.path,
      fingerprint=excluded.fingerprint,subject=excluded.subject`,
      )
      .run(source.owner, source.revision, path, fingerprint, subject);
  }
  async read(
    owner: string,
    path: string,
    subject: number,
    match: (signature: string) => HistoryView | undefined,
  ) {
    const fingerprint = await this.fingerprint(path);
    if (!fingerprint) return;
    const row = this.store.db
      .prepare(
        `SELECT v.signature FROM feed_receipts r
      JOIN feed_views v ON v.owner=r.owner AND v.revision=r.revision
      WHERE r.owner=? AND r.path=? AND r.fingerprint=? AND r.subject=?`,
      )
      .get(owner, path, fingerprint, subject);
    const signature = String(row?.['signature'] ?? '');
    if (!signature.startsWith(`${HISTORY_VERSION}:`)) return;
    const seq = Number(signature.slice(signature.indexOf(':') + 1));
    const view = match(signature);
    return view && Number.isSafeInteger(seq) ? { view, seq } : undefined;
  }
}
