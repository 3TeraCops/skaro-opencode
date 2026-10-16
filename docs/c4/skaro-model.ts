import type { C4Model } from '../../packages/core/src/c4/model.ts';
import { skaroElements } from './skaro-elements.ts';
import { skaroRelationships } from './skaro-relationships.ts';
import { skaroViews } from './skaro-views.ts';

/** Current repository architecture. It is documentation, not an application test backend. */
export const skaroC4: C4Model = {
  version: 1, revision: 1, title: 'Skaro',
  elements: skaroElements, relationships: skaroRelationships, views: skaroViews,
  specifications: [], questions: [],
  exclusions: [{ kind: 'component', scope: 'database', state: 'current',
    reason: 'SQLite — встроенный сторонний движок; собственные операции AppDb описаны в main process, внутренние компоненты SQLite не реализуются в Skaro.',
    evidence: 'packages/core/src/db/appdb.ts imports node:sqlite' }],
};
