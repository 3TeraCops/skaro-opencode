import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AppDb } from './appdb.ts';
import { randomUUID } from 'node:crypto';

const profile = process.env.SKARO_DB_VERIFY_PATH;
const populatedProfile = process.env.SKARO_DB_POPULATED_VERIFY_PATH;

test.skipIf(!profile)('read-only task collections do not start a namespace migration', () => {
  const reader = AppDb.readOnly(profile!);
  const inspect = new DatabaseSync(profile!, { readOnly: true });
  try {
    // A missing namespace is a read request; no rows or test data are inserted.
    const key = `readonly-check.${randomUUID()}`;
    const migration = () =>
      inspect.prepare('SELECT 1 FROM collection_migrations WHERE key=?').get(key);
    expect(migration()).toBeUndefined();
    expect(reader.collections.all(key)).toEqual([]);
    expect(reader.collections.get(key, key)).toBeUndefined();
    expect(reader.collections.all(key)).toEqual([]);
    expect(migration()).toBeUndefined();
  } finally {
    inspect.close();
    reader.close();
  }
});

test.skipIf(!populatedProfile)(
  'read-only access preserves real migrated collection records',
  () => {
    const inspect = new DatabaseSync(populatedProfile!, { readOnly: true });
    const reader = AppDb.readOnly(populatedProfile!);
    try {
      const canonical = inspect
        .prepare('SELECT collection,id,value FROM collection_records ORDER BY rowid LIMIT 1')
        .get() as { collection: string; id: string; value: string };
      expect(canonical).toBeDefined();
      expect(
        JSON.stringify(reader.collections.get(canonical.collection, canonical.id)) ===
          canonical.value,
      ).toBe(true);
      expect(
        reader.collections
          .all<{ id: string }>(canonical.collection)
          .some((item) => item.id === canonical.id),
      ).toBe(true);
    } finally {
      reader.close();
      inspect.close();
    }
  },
);
