import { expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';
import { PayloadStore } from './background/payload-store';
import { ProjectIndex } from './background/project-index';
import { cachedProjectCards } from './project-card-cache';

it('keeps startup responsive during a real SQLite cache lock and reads full cards afterwards', async () => {
  const fixture = await CompletionFixture.create();
  try {
    const store = new PayloadStore(fixture.root, 'registry.db');
    let expected;
    try {
      const index = new ProjectIndex(store);
      index.query({ query: '', sort: 'name' });
      expected = cachedProjectCards(fixture.db.filePath, [fixture.projectId]);
      expect(expected.map((card) => card.id)).toEqual([fixture.projectId]);
      store.db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
      const started = performance.now();
      expect(cachedProjectCards(fixture.db.filePath, [fixture.projectId])).toEqual([]);
      expect(performance.now() - started).toBeLessThan(1000);
      store.db.exec('ROLLBACK');
    } finally {
      store.db.close();
    }
    expect(cachedProjectCards(fixture.db.filePath, [fixture.projectId])).toEqual(expected);
  } finally {
    await fixture.close();
  }
});
