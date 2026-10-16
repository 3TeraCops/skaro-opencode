/** Persisted transport payload. The domain validates the model and applies these exact files. */
export interface ArchitectureProposal {
  type: 'architecture';
  packageId: string;
  title: string;
  summary: string;
  baseRevision: number;
  files: { path: string; before: string | null; after: string }[];
  task?: { id: string; runId: string };
  before: string;
  after: string;
}
