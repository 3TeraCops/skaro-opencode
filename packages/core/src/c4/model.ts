/** C4 is a shared semantic model; diagrams and document sections are projections of it. */
export type C4State = 'current' | 'planned';
export type C4Kind = 'person' | 'system' | 'container' | 'component' | 'code' | 'deployment-node';
export type C4ViewKind = 'context' | 'container' | 'component' | 'code' | 'dynamic' | 'deployment';

export interface C4Element {
  id: string;
  kind: C4Kind;
  name: string;
  description: string;
  state: C4State;
  external: boolean;
  parent?: string;
  technology?: string;
  /** Repository-relative code paths. Existing paths are checked in the actual checkout. */
  code: string[];
  /** Source document paths or repository-relative code paths, with an explanation. */
  evidence: string[];
  decisions: string[];
  /** A future revision of an existing element keeps its identity and current description. */
  planned?: {
    name: string;
    description: string;
    technology?: string;
    parent?: string;
    code: string[];
    evidence: string[];
    decisions: string[];
  };
}

export interface C4Relationship {
  id: string;
  source: string;
  target: string;
  description: string;
  technology: string;
  state: C4State;
  evidence: string[];
  decisions: string[];
  planned?: {
    source: string;
    target: string;
    description: string;
    technology: string;
    evidence: string[];
    decisions: string[];
  };
}

export interface C4View {
  id: string;
  kind: C4ViewKind;
  title: string;
  scope: string;
  state: C4State;
  elements: string[];
  relationships: string[];
  /** Ordered interactions, referencing model relationships; a relationship may repeat. */
  steps: { relationship: string; description: string }[];
  /** Deployment instances; the same container may run on more than one node. */
  instances: { id: string; element: string; node: string }[];
  /** Explicit deployment topology where a container has multiple runtime instances. */
  instanceRelationships?: { relationship: string; source: string; target: string }[];
}

export interface C4Requirement {
  id: string;
  elements: string[];
  relationships: string[];
  views: string[];
}

export interface C4Specification {
  /** SPEC number, e.g. 0003; this binding belongs to the actual document at path. */
  id: string;
  path: string;
  /** SHA-256 of the authored body, excluding the generated C4 section. */
  bodyHash: string;
  impact: 'changes' | 'uses';
  description: string;
  elements: string[];
  relationships: string[];
  views: string[];
  requirements: C4Requirement[];
}

export interface C4Model {
  version: 1;
  revision: number;
  title: string;
  elements: C4Element[];
  relationships: C4Relationship[];
  views: C4View[];
  specifications: C4Specification[];
  /** An explicit, evidenced applicability decision, never a silently skipped level. */
  exclusions: {
    kind: C4ViewKind;
    scope: string;
    state: C4State;
    reason: string;
    evidence: string;
  }[];
  questions: { id: string; question: string; affects: string[] }[];
  /** Planned removals preserve current facts until the corresponding code is published. */
  removals?: { id: string; reason: string; evidence: string }[];
}

export interface C4FileChange {
  /** Relative to .skaro/. Model and projections are owned by the service. */
  path: string;
  before: string | null;
  after: string;
}

export interface C4Package {
  id: string;
  title: string;
  summary: string;
  baseRevision: number;
  files: C4FileChange[];
  /** A task proposal is tied to the calling run, not arbitrary task IDs. */
  task?: { id: string; runId: string };
  /** Internal in-place completion: journal its task status with architecture realization. */
  completion?: { taskId: string; path: string };
}

export interface C4Review {
  revision: number;
  /** Hash of the code change set inspected by the agent. */
  changeHash: string;
  elements: string[];
  relationships: string[];
  evidence: string;
}

export const C4_MODEL_PATH = 'c4/model.json';
