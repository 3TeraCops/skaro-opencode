// Cache disposable snapshots of actual project files; never generate project data for validation.
import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { ArtifactStore } from '@skaro/core';
import { ProjectArtifactMemory } from '../src/main/project-artifact-memory';
import { artifactBytes } from '../src/main/background/artifact-weight';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires an isolated existing real project');
test('evicts oversized project reads while preserving the active operation and concurrent reads', async () => {
  test.setTimeout(120_000);
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const row = db.prepare('SELECT path FROM projects WHERE id=?').get(project!);
  db.close();
  if (!row) throw new Error('The real project is missing');
  const store = new ArtifactStore(String(row['path']));
  let loads = 0;
  const load = async () => {
    loads++;
    const value = await store.load();
    return { value, bytes: artifactBytes(value) };
  };
  const memory = new ProjectArtifactMemory(1);
  const first = memory.read(project!, load);
  const concurrent = memory.read(project!, load);
  expect(concurrent).toBe(first);
  const before = await first;
  expect(loads).toBe(1);
  expect(before.architecture!.body.length).toBeGreaterThan(500_000);
  const after = await memory.read(project!, load);
  expect(loads).toBe(2);
  expect(after).not.toBe(before);
  expect(after.architecture!.body).toBe(before.architecture!.body);
  expect(after.tasks.map((task) => task.id)).toEqual(before.tasks.map((task) => task.id));
  // An ordinary cache retains a read until an explicit filesystem/defaults invalidation.
  const bytes = artifactBytes(before);
  console.log('Actual full project retained estimate (bytes):', bytes);
  const retained = new ProjectArtifactMemory(bytes + 1);
  const cached = await retained.read(project!, load);
  expect(await retained.read(project!, load)).toBe(cached);
  retained.forget(project!);
  expect(await retained.read(project!, load)).not.toBe(cached);
  expect(before.architecture!.body).toBe(after.architecture!.body);
});
