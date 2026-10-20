import { ArtifactStore, type AppDb, type ConfigDefaults } from '@skaro/core';
import { ArtifactIndex } from './artifact-index';
import type { PayloadStore } from './payload-store';
/** Graph/status readers need frontmatter, never every task description and document body. */
export function projectMetadata(store: PayloadStore, db: AppDb, root: string) {
  const index = new ArtifactIndex(store, root);
  return new ArtifactStore(
    root,
    () => db.getSetting<ConfigDefaults>('defaults.project', {}),
    () => [],
    { read: (path) => index.read(path, false), invalidate: (path) => index.invalidate(path) },
  ).load(true);
}
