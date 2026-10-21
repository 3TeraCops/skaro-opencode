/** Browser-safe graph contract. Source text and credentials never cross this boundary. */
export type Origin = 'accepted-c4' | 'extracted-code' | 'extracted-document' | 'analyzer-inferred';
export type Resolution = 'explicit' | 'resolved' | 'inferred' | 'unresolved';
export type ArchitectureState = 'current' | 'planned';
export type NodeKind =
  | 'architecture'
  | 'instance'
  | 'file'
  | 'symbol'
  | 'endpoint'
  | 'event'
  | 'model'
  | 'service'
  | 'document'
  | 'requirement'
  | 'task'
  | 'milestone'
  | 'package';
export type EdgeKind =
  | 'contains'
  | 'imports'
  | 'exports'
  | 'references'
  | 'calls'
  | 'inherits'
  | 'implements'
  | 'handles'
  | 'requests'
  | 'emits'
  | 'consumes'
  | 'reads'
  | 'writes'
  | 'model-relation'
  | 'deploys'
  | 'depends-on'
  | 'documents'
  | 'covers'
  | 'governed-by'
  | 'implements-requirement'
  | 'interacts';
export interface SourceRef {
  checkoutId: string;
  path: string;
  contentHash: string;
  start?: number;
  end?: number;
  line?: number;
  endLine?: number;
}
export interface Evidence {
  sourceRef: SourceRef;
  rule: string;
  explanation: string;
}
export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName?: string;
  origin: Origin;
  sources: SourceRef[];
  state?: ArchitectureState;
  attributes: Record<string, string | number | boolean | string[]>;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  origin: Origin;
  resolution: Resolution;
  state?: ArchitectureState;
  evidence: Evidence[];
  label?: string;
  members?: { count: number; ids: string[]; truncated: boolean };
}
export interface UnresolvedReference {
  source: string;
  name: string;
  kind: EdgeKind;
  ref: SourceRef;
  reason: string;
}
export interface Coverage {
  found: number;
  parsed: number;
  reused: number;
  skipped: number;
  errors: number;
  unresolved: number;
  languages: Record<string, { files: number; parsed: number; errors: number }>;
  limitations: string[];
  diagnostics: { path: string; message: string }[];
}
export interface GraphSnapshot {
  schemaVersion: 1;
  id: string;
  projectId: string;
  checkoutId: string;
  generation: number;
  root: string;
  fingerprint: string;
  head: string;
  analyzerVersion: string;
  createdAt: number;
  c4Revision?: number;
  c4Hash?: string;
  coverage: Coverage;
  nodes: number;
  edges: number;
}
export type GraphPhase =
  'queued' | 'indexing' | 'ready' | 'partial' | 'stale' | 'cancelled' | 'error' | 'unavailable';
export interface GraphStatus {
  projectId: string;
  phase: GraphPhase;
  generation: number;
  snapshot?: GraphSnapshot;
  progress?: { done: number; total: number; stage: string };
  error?: string;
}
export interface GraphScope {
  projectId: string;
  checkoutId: string;
  snapshotId: string;
  requestId: string;
}
export interface GraphFilter {
  kinds?: NodeKind[];
  edges?: EdgeKind[];
  origins?: Origin[];
  resolutions?: Resolution[];
  state?: ArchitectureState | 'all';
  languages?: string[];
  subsystems?: string[];
  /** Legacy saved filters; new controls use the arrays above. */
  language?: string;
  subsystem?: string;
}
export interface GraphQuery extends GraphScope {
  filter?: GraphFilter;
  cursor?: string;
  limit?: number;
  operation: 'overview' | 'expand' | 'search' | 'details' | 'neighbors' | 'path' | 'impact';
  id?: string;
  target?: string;
  text?: string;
  direction?: 'out' | 'in' | 'both';
  depth?: number;
  expanded?: string[];
}
export interface GraphPage {
  snapshotId: string;
  requestId: string;
  queryHash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cursor?: string;
  hasMore: boolean;
  totals: { nodes: number; edges: number };
  omitted: number;
  aggregated: number;
  incomplete: boolean;
  reason?: string;
  unresolved?: UnresolvedReference[];
  path?: string[];
}
export interface ScenarioStep {
  ordinal: number;
  relationshipId: string;
  sourceId: string;
  targetId: string;
  description: string;
  technology: string;
  evidence: Evidence[];
}
export interface GraphScenario {
  snapshotId: string;
  c4Revision: number;
  c4Hash: string;
  viewId: string;
  title: string;
  state: ArchitectureState;
  steps: ScenarioStep[];
  participants: string[];
  diagnostics: string[];
}
export interface GraphViewState {
  version: 1;
  checkoutId: string;
  selected?: string;
  filter: GraphFilter;
  expanded: string[];
  camera?: { x: number; y: number; ratio: number; angle: number };
  positions?: Record<string, { x: number; y: number }>;
  history: string[];
  scenario?: { viewId: string; c4Hash: string; step: number; speed: number };
}
