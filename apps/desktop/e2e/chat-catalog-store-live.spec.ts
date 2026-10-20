// Canonical database copied from the real profile; no generated chats or stand-in backend.
import { expect, test } from '@playwright/test';
import { AppDb } from '@skaro/core';
import { ChatCatalogReader } from '../src/main/background/chat-catalog';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertLiveProfileBoundary } from './live-profile-boundary';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires the existing real profile');

test('migrates actual chat metadata and keeps counters and order atomic across archive and rollback', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  assertLiveProfileBoundary(profile!);
  const directory = info.outputPath('actual-profile');
  mkdirSync(directory, { recursive: true });
  // Copy all SQLite files while no application is using this isolated source profile.
  const source = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const actual = source
    .prepare(
      'SELECT id,archived,updated_at FROM chats WHERE project_id=? AND task_id IS NULL ORDER BY updated_at DESC,rowid DESC',
    )
    .all(project!);
  // SQLite VACUUM INTO captures the actual WAL-backed database as one consistent snapshot.
  source.prepare('VACUUM INTO ?').run(join(directory, 'skaro.db'));
  source.close();
  const db = AppDb.open(join(directory, 'skaro.db'));
  const reader = new ChatCatalogReader(directory);
  const raw = new DatabaseSync(join(directory, 'skaro.db'));
  const selected = actual.find((chat) => !chat['archived']);
  if (!selected) throw new Error('No real active chat is available');
  try {
    const initial = reader.query(project!, false);
    expect(initial.source.count).toBe(actual.filter((chat) => !chat['archived']).length);
    expect(initial.archivedCount).toBe(actual.filter((chat) => chat['archived']).length);
    const all = [];
    for (let start = 0; start < initial.source.count; start += 16) {
      const page = reader.page(initial.source, start);
      expect(page.chats.length).toBeLessThanOrEqual(16);
      all.push(...page.chats.map((chat) => chat.id));
    }
    expect(all).toEqual(actual.filter((chat) => !chat['archived']).map((chat) => chat['id']));
    const queryPlan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM chats WHERE project_id=? AND archived=0 AND task_id IS NULL ORDER BY updated_at DESC,rowid DESC LIMIT 16 OFFSET 32`,
      )
      .all(project!);
    expect(queryPlan.some((row) => String(row['detail']).includes('chats_catalog_order'))).toBe(
      true,
    );
    expect(queryPlan.some((row) => String(row['detail']).includes('TEMP B-TREE'))).toBe(false);
    db.updateChat(String(selected['id']), { archived: true });
    const archived = reader.query(project!, true);
    expect(archived.activeCount).toBe(initial.activeCount - 1);
    expect(archived.archivedCount).toBe(initial.archivedCount + 1);
    expect(archived.chats[0]!.id).toBe(selected['id']);
    expect(archived.source.revision).toBeGreaterThan(initial.source.revision);
    const revision = archived.source.revision;
    raw.exec('BEGIN IMMEDIATE');
    try {
      raw.prepare('DELETE FROM chats WHERE id=?').run(selected['id']!);
      expect(reader.query(project!, true).source.revision).toBe(revision);
    } finally {
      raw.exec('ROLLBACK');
    }
    expect(reader.query(project!, true)).toEqual(archived);
    db.updateChat(String(selected['id']), { archived: false });
    const restored = reader.query(project!, false);
    expect(restored.activeCount).toBe(initial.activeCount);
    expect(restored.archivedCount).toBe(initial.archivedCount);
    expect(reader.find(initial.source, String(selected['id'])).index).toBe(0);
    console.log('Actual SQLite chat catalog:', { count: actual.length, queryPlan });
  } finally {
    reader.close();
    raw.close();
    db.close();
  }
});
