import type { C4Specification, C4Requirement } from '../../packages/core/src/c4/model.ts';
import { c4BodyHash } from '../../packages/core/src/c4/documents.ts';

/** Traceability for the repository's authored C4 specification. */
export function skaroC4Specification(body: string): C4Specification {
  const requirements: C4Requirement[] = [
    { id: 'R-1', elements: ['c4domain'], relationships: [], views: ['maincomponents'] },
    { id: 'R-2', elements: ['c4domain'], relationships: [], views: ['maincomponents', 'domaincode'] },
    { id: 'R-3', elements: ['c4service', 'c4domain'], relationships: ['model'], views: ['maincomponents', 'c4scenario'] },
    { id: 'R-4', elements: ['documents', 'c4viewer'], relationships: ['attachment'], views: ['renderercomponents'] },
    { id: 'R-5', elements: ['c4viewer', 'canvas', 'preview', 'layout'], relationships: ['canvaslayout', 'previewlayout'], views: ['renderercomponents', 'viewercode'] },
    { id: 'R-6', elements: ['c4service', 'c4domain', 'transaction'], relationships: ['model', 'packagejournal'], views: ['maincomponents', 'domaincode', 'c4scenario'] },
    { id: 'R-7', elements: ['imports', 'importstage', 'importpackage'], relationships: ['importmodel', 'importprepare'], views: ['maincomponents', 'importcode', 'importscenario'] },
    { id: 'R-8', elements: ['completion', 'c4service', 'codereview'], relationships: ['review'], views: ['maincomponents', 'servicecode', 'c4scenario'] },
    { id: 'R-9', elements: ['completion', 'c4domain', 'publication'], relationships: ['realize'], views: ['maincomponents', 'completioncode', 'c4scenario'] },
  ];
  const refs = (field: 'elements' | 'relationships' | 'views') => [...new Set(requirements.flatMap((r) => r[field]))];
  return { id: '0001', path: 'specs/0001-c4.md', bodyHash: c4BodyHash(body), impact: 'changes',
    description: 'C4 в Skaro', elements: refs('elements'), relationships: refs('relationships'), views: refs('views'), requirements };
}
