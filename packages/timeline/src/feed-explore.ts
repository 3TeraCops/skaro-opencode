import type { Item } from './model.ts';

/** Explore summary counts: files read, searches, pages, listings, images viewed. */
export function exploreCounts(items: Extract<Item, { kind: 'explore' }>[]): {
  read: number;
  images: number;
  search: string[];
  list: number;
  pages: number;
  web: string[];
} {
  const counts = {
    read: 0,
    images: 0,
    search: [] as string[],
    list: 0,
    pages: 0,
    web: [] as string[],
  };
  const seen = new Set<string>();
  for (const item of items) {
    if (item.op === 'read') {
      if (item.image) counts.images++;
      else if (!seen.has(item.target)) {
        seen.add(item.target);
        counts.read++;
      }
    } else if (item.op === 'search') counts.search.push(item.target);
    else if (item.op === 'list') counts.list++;
    else if (item.op === 'fetch') counts.pages++;
    else counts.web.push(item.target);
  }
  return counts;
}
