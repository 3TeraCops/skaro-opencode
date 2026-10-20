import {
  groupFeedRows,
  actionGroupState,
  actionGroupSummary,
  actionGroupDiffStats,
  type FeedRow,
  type TimelineState,
} from '@skaro/timeline';
import type { HistoryBlock, HistoryRow, HistorySource } from '../../shared/history';

/** Keep fold summaries in the page; expanded children are independent indexed ranges. */
export function historyRows(
  state: TimelineState,
  save: (key: string, blocks: HistoryBlock[]) => HistorySource,
): HistorySource {
  const waiting = new Set(
    state.interactions
      .filter((i) => i.kind === 'approval')
      .map((i) => i.itemId)
      .filter(Boolean),
  );
  function rows(input: FeedRow[], key: string): HistorySource {
    const replies = new Map<string, Extract<FeedRow, { type: 'agent' }>>();
    for (let i = 0; i < input.length; i++) {
      const row = input[i]!;
      if (row.type !== 'turn_end') continue;
      for (let j = i - 1; j >= 0; j--) {
        const previous = input[j]!;
        if (previous.type === 'user' || previous.type === 'turn_end') break;
        if (previous.type === 'agent') {
          if (previous.final) replies.set(row.id, previous);
          break;
        }
      }
    }
    const ended = new Set([...replies.values()].map((row) => row.id));
    const lastEnd = input.findLast((row) => row.type === 'turn_end')?.id;
    function thin(row: FeedRow): HistoryRow {
      if (row.type !== 'task') return row;
      const history = rows(row.children, `task:${row.id}`);
      return {
        ...row,
        children: [],
        history,
        hasAgentReply: row.children.some((child) => child.type === 'agent'),
      };
    }
    const blocks: HistoryBlock[] = groupFeedRows(input).map((block) => {
      if (block.type === 'actions') {
        const history = save(
          `actions:${block.id}`,
          block.rows.map((row) => ({ type: 'row', id: row.id, row: thin(row) })),
        );
        return {
          ...block,
          rows: [],
          history,
          presentation: {
            parts: actionGroupSummary(block),
            state: actionGroupState(block, waiting as Set<string>),
            diff: actionGroupDiffStats(block),
          },
        };
      }
      return {
        ...block,
        row: thin(block.row),
        presentation: {
          reply: replies.get(block.id)?.item.text,
          replyId: replies.get(block.id)?.item.id,
          ended: ended.has(block.id),
          last: block.row.type === 'notice' ? block.id === input.at(-1)?.id : block.id === lastEnd,
        },
      };
    });
    return save(key, blocks);
  }
  // Imported lazily by the projection worker's caller; no native transport work runs in UI.
  return rows(feedRowsOf(state), 'root');
}

import { feedRows as feedRowsOf } from '@skaro/timeline';
