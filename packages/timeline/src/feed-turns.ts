import type { FileChange, Item } from './model.ts';
import type { TurnState } from './state.ts';
import type { FileRow, FeedRow, TurnFile } from './feed.ts';
type Of<K extends Item['kind']> = Extract<Item, { kind: K }>;

export function fileRow(file: FileChange, item: Of<'file_change'>): FileRow {
  return {
    type: 'file',
    id: `${item.id}:${file.path}`,
    path: file.path,
    change: file.change,
    ...(file.movePath ? { movePath: file.movePath } : {}),
    ...(file.added !== undefined ? { added: file.added } : {}),
    ...(file.removed !== undefined ? { removed: file.removed } : {}),
    diffs: file.diff ? [file.diff] : [],
    status: item.status,
    items: [item],
  };
}

export function mergeFile(row: FileRow, file: FileChange, item: Of<'file_change'>): void {
  if (file.added !== undefined) row.added = (row.added ?? 0) + file.added;
  if (file.removed !== undefined) row.removed = (row.removed ?? 0) + file.removed;
  if (file.diff) row.diffs.push(file.diff);
  row.items.push(item);
  // The row shows the latest state: a pending or failed edit wins over earlier done ones.
  row.status = item.status;
}

export function turnEnd(turn: TurnState, items: Item[]): FeedRow {
  let start = Infinity;
  let end = 0;
  const files = new Map<string, TurnFile>();
  for (const item of items) {
    start = Math.min(start, item.startedAt);
    end = Math.max(end, item.endedAt ?? item.startedAt);
    if (item.kind === 'file_change' && item.status === 'done') {
      for (const f of item.files) {
        const file: TurnFile = files.get(f.path) ?? { path: f.path, change: f.change, diffs: [] };
        if (file.change !== 'add' || f.change === 'delete') file.change = f.change;
        if (f.movePath) file.movePath = f.movePath;
        if (f.added !== undefined) file.added = (file.added ?? 0) + f.added;
        if (f.removed !== undefined) file.removed = (file.removed ?? 0) + f.removed;
        if (f.diff) file.diffs.push(f.diff);
        files.set(f.path, file);
      }
    }
  }
  return {
    type: 'turn_end',
    id: `end:${turn.id}`,
    turn,
    durationMs: Number.isFinite(start) ? Math.max(0, end - start) : 0,
    files: [...files.values()],
    ...(turn.usage ? { tokens: turn.usage.inputTokens + turn.usage.outputTokens } : {}),
  };
}
