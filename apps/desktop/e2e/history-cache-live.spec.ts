import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PayloadStore } from '../src/main/background/payload-store';
import { HistoryIndex } from '../src/main/background/history-index';
import { HistoryPageCache } from '../src/renderer/src/feed/history-page-cache';
import { recordedControlSamples } from './recorded-control-samples';
import type { HistoryBlock, HistoryPage } from '../src/shared/history';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires actual recorded histories in the separate test project');
const controls = ['session.started', 'plan.updated', 'usage', 'limits', 'activity', 'status'];

test('preserves loaded and pending real pages on controls and invalidates changed content', async ({
  browserName: _browserName,
}, info) => {
  const recorded = await recordedControlSamples(profile!, project!);
  const directory = info.outputPath('read-model');
  mkdirSync(directory, { recursive: true });
  const store = new PayloadStore(directory);
  const index = new HistoryIndex(store);
  const errors: string[] = [];
  let refreshes = 0;
  let reads = 0,
    changes = 0;
  const published: HistoryPage[] = [];
  function pages() {
    const blocks = new Map<number, HistoryBlock>();
    const cache = new HistoryPageCache({
      blocks,
      read: async (source, start, limit) => {
        reads++;
        return index.page(source, start, limit);
      },
      onpage: (page) => published.push(page),
      onstale: () => refreshes++,
      onerror: (error) => {
        if (error) errors.push(error);
      },
      onchange: () => changes++,
    });
    return { cache, blocks };
  }
  try {
    let checked = 0;
    for (const [at, sample] of recorded.samples.entries()) {
      for (const mode of ['loaded', 'pending'] as const) {
        const owner = `${at}:${mode}`;
        const before = index.withSnapshot(() =>
          index.initialize(owner, 'before', structuredClone(sample.before)),
        );
        const { cache, blocks } = pages();
        cache.setSource(before.source);
        const initialReads = reads;
        const initialPages = published.length;
        const first = cache.load(0, before.source.count, new Set());
        if (mode === 'loaded') await first;
        const saved = [...blocks.values()];
        const updated = index.withSnapshot(() => index.events(owner, [sample.event], 'after'))!;
        cache.setSource(updated.source);
        await Promise.all([first, cache.load(0, updated.source.count, new Set())]);
        expect(reads - initialReads).toBe(Math.ceil(before.source.count / 16));
        expect(published.length - initialPages).toBe(Math.ceil(before.source.count / 16));
        if (mode === 'loaded')
          expect([...blocks.values()].every((block, i) => block === saved[i])).toBe(true);
        // A saved viewport from the earlier control revision is still current content.
        cache.seed(index.page(before.source, 0, 32));
        await cache.load(0, updated.source.count, new Set());
        expect(reads - initialReads).toBe(Math.ceil(before.source.count / 16));
        checked++;
      }
    }
    const sample = recorded.samples.find(
      (sample) => sample.next && !controls.includes(sample.next.t),
    );
    expect(sample).toBeDefined();
    const before = index.withSnapshot(() =>
      index.initialize('structural', 'before', structuredClone(sample!.before)),
    );
    const middle = index.withSnapshot(() => index.events('structural', [sample!.event], 'middle'))!;
    const oldPage = index.page(middle.source, 0, 32);
    const { cache, blocks } = pages();
    cache.setSource(middle.source);
    const structuralPages = published.length;
    const oldRequest = cache.load(0, middle.source.count, new Set());
    const changed = index.withSnapshot(() =>
      index.events('structural', [sample!.next!], 'changed'),
    )!;
    expect(changed.source.contentRevision).toBeGreaterThan(middle.source.contentRevision!);
    cache.setSource(changed.source);
    await Promise.all([oldRequest, cache.load(0, changed.source.count, new Set())]);
    expect(published.length - structuralPages).toBe(Math.ceil(changed.source.count / 16));
    const expected = index.page(changed.source, 0, 32);
    expect([...blocks.values()]).toEqual(expected.blocks);
    cache.seed(oldPage);
    expect([...blocks.values()]).toEqual(expected.blocks);
    // A response newer than its requested source waits for its matching announcement.
    const late = pages();
    const beforeRefresh = refreshes;
    late.cache.setSource(before.source);
    await late.cache.load(0, before.source.count, new Set());
    expect(late.blocks.size).toBe(0);
    expect(refreshes).toBe(beforeRefresh + 1);
    late.cache.setSource(changed.source);
    await late.cache.load(0, changed.source.count, new Set());
    expect([...late.blocks.values()]).toEqual(expected.blocks);
    // Actual older read-model data is adopted after eviction of the newly added version index.
    const legacy = index.withSnapshot(() =>
      index.initialize('legacy', 'before', structuredClone(sample!.before)),
    );
    store.db.prepare('DELETE FROM feed_page_revisions WHERE owner=?').run('legacy');
    const { contentRevision: _content, ...oldSource } = legacy.source;
    const saved = pages();
    saved.cache.setSource(oldSource);
    saved.cache.seed(index.page(oldSource, 0, 32));
    const adopted = index.withSnapshot(() => index.events('legacy', [sample!.event], 'adopted'))!;
    expect(adopted.source.contentRevision).toBe(legacy.source.revision);
    saved.cache.setSource(adopted.source);
    const legacyReads = reads;
    await saved.cache.load(0, adopted.source.count, new Set());
    expect(reads).toBe(legacyReads);
    expect(new HistoryIndex(store).matches('legacy', 'adopted')?.source).toEqual(adopted.source);
    expect(errors).toEqual([]);
    // Close and reopen a real SQLite read model; no replacement API responses are supplied.
    const recoveryDirectory = info.outputPath('recovery');
    mkdirSync(recoveryDirectory, { recursive: true });
    let recoveryStore = new PayloadStore(recoveryDirectory);
    let recoveryIndex = new HistoryIndex(recoveryStore);
    const recoveryView = recoveryIndex.withSnapshot(() =>
      recoveryIndex.initialize('recovery', 'saved', structuredClone(sample!.before)),
    );
    const recoveredBlocks = new Map<number, HistoryBlock>();
    const failures: string[] = [];
    const recovery = new HistoryPageCache({
      blocks: recoveredBlocks,
      read: async (source, start, limit) => recoveryIndex.page(source, start, limit),
      onpage: (page) => published.push(page),
      onerror: (error) => {
        if (error) failures.push(error);
      },
      onchange: () => changes++,
    });
    recovery.setSource(recoveryView.source);
    recoveryStore.db.close();
    await recovery.load(0, recoveryView.source.count, new Set());
    expect(failures.length).toBe(1);
    recoveryStore = new PayloadStore(recoveryDirectory);
    try {
      recoveryIndex = new HistoryIndex(recoveryStore);
      recovery.setSource(recoveryIndex.matches('recovery', 'saved')!.source);
      await recovery.load(0, recoveryView.source.count, new Set());
      expect([...recoveredBlocks.values()]).toEqual(
        recoveryIndex.page(recoveryView.source, 0, 32).blocks,
      );
    } finally {
      recoveryStore.db.close();
    }
    console.log(
      'Real page cache:',
      JSON.stringify({ checkedControlCases: checked, reads, changes, structuralAndLegacy: true }),
    );
  } finally {
    store.db.close();
  }
});
