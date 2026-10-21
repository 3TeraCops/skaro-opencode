import { createHash } from 'node:crypto';
import type {
  GraphNode,
  GraphEdge,
  EdgeKind,
  SourceRef,
  Origin,
  Resolution,
  UnresolvedReference,
} from '@skaro/core/graph-view';

export const ANALYZER_VERSION = 'graph-1.0.5';
export const hash = (text: string | Uint8Array): string =>
  createHash('sha256').update(text).digest('hex');
export interface SourceFile {
  path: string;
  hash: string;
  text: string;
  language: string;
}
export interface FileFacts {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
}
export class Facts {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  readonly unresolved: UnresolvedReference[] = [];
  readonly checkoutId: string;
  private readonly lineStarts = new WeakMap<SourceFile, number[]>();
  constructor(checkoutId: string) {
    this.checkoutId = checkoutId;
  }
  ref(file: SourceFile, start?: number, end?: number): SourceRef {
    const line = (offset: number): number => {
      let starts = this.lineStarts.get(file);
      if (!starts) {
        starts = [0];
        for (let index = 0; index < file.text.length; index++)
          if (file.text.charCodeAt(index) === 10) starts.push(index + 1);
        this.lineStarts.set(file, starts);
      }
      let low = 0,
        high = starts.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle]! <= offset) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    return {
      checkoutId: this.checkoutId,
      path: file.path,
      contentHash: file.hash,
      ...(start === undefined
        ? {}
        : {
            start,
            end,
            line: line(start),
            endLine: line(end ?? start),
          }),
    };
  }
  node(node: GraphNode): string {
    this.nodes.set(node.id, node);
    return node.id;
  }
  file(file: SourceFile): string {
    return this.node({
      id: `file:${file.path}`,
      kind: file.language === 'markdown' ? 'document' : 'file',
      name: file.path.split('/').at(-1)!,
      qualifiedName: file.path,
      origin: file.language === 'markdown' ? 'extracted-document' : 'extracted-code',
      sources: [this.ref(file)],
      attributes: { language: file.language, path: file.path },
    });
  }
  edge(
    source: string,
    target: string,
    kind: EdgeKind,
    ref: SourceRef,
    rule: string,
    explanation: string,
    origin: Origin = 'extracted-code',
    resolution: Resolution = 'resolved',
    label?: string,
  ): string {
    const id = `edge:${hash(`${source}\0${target}\0${kind}\0${rule}`).slice(0, 28)}`;
    const previous = this.edges.get(id);
    const evidence = { sourceRef: ref, rule: `${ANALYZER_VERSION}/${rule}`, explanation };
    if (previous) {
      if (
        !previous.evidence.some(
          (e) => e.sourceRef.path === ref.path && e.sourceRef.start === ref.start,
        )
      )
        previous.evidence.push(evidence);
    } else
      this.edges.set(id, {
        id,
        source,
        target,
        kind,
        origin,
        resolution,
        evidence: [evidence],
        ...(label ? { label } : {}),
      });
    return id;
  }
  missing(source: string, name: string, kind: EdgeKind, ref: SourceRef, reason: string): void {
    this.unresolved.push({ source, name: name.slice(0, 180), kind, ref, reason });
  }
  merge(facts: FileFacts): void {
    facts.nodes.forEach((node) => this.nodes.set(node.id, node));
    facts.edges.forEach((edge) => this.edges.set(edge.id, edge));
    this.unresolved.push(...facts.unresolved);
  }
}
