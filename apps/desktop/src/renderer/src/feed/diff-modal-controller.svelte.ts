// State of the diff window: which file, expanded or not, the turn's diff or a refreshed one.

import type { TurnFile } from '@skaro/timeline';
import { t } from '@skaro/ui';
import type { FileDiff } from '../../../shared/ipc';
import { createDiffProjection } from './diff-projection.svelte';

const CODE =
  /\.(c|cc|cjs|cpp|cs|css|go|h|hpp|html|java|js|json|jsx|kt|mjs|php|py|rb|rs|scss|sh|sql|swift|ts|tsx)$/i;

export function isCodePath(path: string): boolean {
  return CODE.test(path);
}

export function createDiffModalController(options: {
  files: () => TurnFile[];
  start: () => number;
  /** The file's current changes in the working folder ("Обновить"). */
  load: (path: string) => Promise<FileDiff>;
  onerror: (error: string) => void;
}) {
  // svelte-ignore state_referenced_locally
  let index = $state(options.start());
  let expanded = $state(false);
  let spin = $state(0);
  let refreshing = $state(false);
  /** Refreshed diffs by path; the turn's own diff until "Обновить". */
  let fresh = $state<Record<string, FileDiff>>({});

  const file = $derived(options.files()[index]!);
  const refreshed = $derived(fresh[file.path]);
  const change = $derived.by(() => {
    if (!refreshed) return file.change;
    if (refreshed.status === 'added') return 'add' as const;
    if (refreshed.status === 'deleted') return 'delete' as const;
    return file.change === 'move' ? ('move' as const) : ('update' as const);
  });
  const document = createDiffProjection(
    () => ({
      diffs: refreshed ? (refreshed.diff ? [refreshed.diff] : []) : file.diffs,
      change,
      path: file.movePath ?? file.path,
    }),
    options.onerror,
  );
  const counts = $derived.by(() => {
    if (!refreshed && (file.added !== undefined || file.removed !== undefined))
      return { added: file.added ?? 0, removed: file.removed ?? 0 };
    return document.projection?.counts ?? { added: 0, removed: 0 };
  });

  function go(next: number): void {
    const count = options.files().length;
    if (next >= 0 && next < count) index = next;
  }

  async function refresh(): Promise<void> {
    const path = file.path;
    spin += 360;
    refreshing = true;
    try {
      const diff = await options.load(path);
      fresh = { ...fresh, [path]: diff };
    } catch {
      // The turn's diff stays; the status line says nothing changed.
    } finally {
      refreshing = false;
    }
  }

  return {
    get index() {
      return index;
    },
    get file() {
      return file;
    },
    get change() {
      return change;
    },
    get lines() {
      return document.projection?.lines;
    },
    get colors() {
      return document.colors;
    },
    get width() {
      return document.projection?.width ?? 0;
    },
    get revision() {
      return document.revision;
    },
    get counts() {
      return counts;
    },
    get expanded() {
      return expanded;
    },
    set expanded(value: boolean) {
      expanded = value;
    },
    get spin() {
      return spin;
    },
    get refreshing() {
      return refreshing;
    },
    get unchanged() {
      return refreshed?.status === 'unchanged';
    },
    get sub() {
      return refreshing
        ? t('diff.refreshing')
        : refreshed
          ? t('diff.refreshed')
          : t('diff.subtitle');
    },
    go,
    refresh,
  };
}
