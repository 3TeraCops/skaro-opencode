import type { FeedRow } from '@skaro/timeline';

/** Full conversation copy is served from the read model, independent of mounted pages. */
export function feedText(rows: readonly FeedRow[]): string {
  return rows
    .map((row): string => {
      switch (row.type) {
        case 'user':
          return row.hidden ? '' : row.item.text;
        case 'agent':
        case 'question':
        case 'reasoning':
        case 'notice':
          return row.item.text ?? '';
        case 'command':
          return `${row.item.command}\n${row.item.output}`;
        case 'tool':
          return `${row.item.server ?? ''}.${row.item.name}\n${row.item.input ?? ''}\n${row.item.output ?? ''}`;
        case 'file':
          return `${row.path}\n${row.diffs.join('\n')}`;
        case 'explore':
          return row.items.map((item) => `${item.target} ${item.detail ?? ''}`).join('\n');
        case 'task':
          return `${row.item.title}\n${feedText(row.children)}\n${row.item.summary ?? ''}`;
        case 'decision':
          return row.item.answer.kind === 'question'
            ? Object.values(row.item.answer.answers)
                .map((answers) => answers.join(', '))
                .join('\n')
            : '';
        case 'proposal':
          return 'title' in row.item.proposal ? (row.item.proposal.title ?? '') : '';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
