import { setImmediate } from 'node:timers/promises';
import type { AppDb } from '@skaro/core';

/** Background recovery visits every project in bounded pages, yielding to owner input. */
export async function* projectRecords(db: Pick<AppDb, 'shell'>) {
  let after = '';
  for (;;) {
    const page = db.shell.page(after);
    if (!page.length) return;
    for (const project of page) yield project;
    after = page.at(-1)!.id;
    await setImmediate();
  }
}
