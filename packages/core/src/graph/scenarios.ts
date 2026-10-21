import { c4AtState, type C4Model } from '../c4/browser.ts';
import type { GraphScenario, GraphSnapshot, SourceRef } from './model.ts';

export function graphScenarios(model: C4Model, snapshot: GraphSnapshot): GraphScenario[] {
  return model.views
    .filter((view) => view.kind === 'dynamic')
    .map((view) => {
      const projection = c4AtState(model, view.state);
      const relationships = new Map(
        projection.relationships
          .filter((relation) => view.state === 'planned' || relation.state === 'current')
          .map((relation) => [relation.id, relation]),
      );
      const elements = new Set(
        projection.elements
          .filter((element) => view.state === 'planned' || element.state === 'current')
          .map((element) => element.id),
      );
      const diagnostics: string[] = [];
      const ref: SourceRef = {
        checkoutId: snapshot.checkoutId,
        path: '.skaro/c4/model.json',
        contentHash: snapshot.c4Hash ?? '',
      };
      const steps = view.steps.flatMap((step, index) => {
        const relation = relationships.get(step.relationship);
        if (
          !relation ||
          !elements.has(relation.source) ||
          !elements.has(relation.target) ||
          !view.relationships.includes(step.relationship)
        ) {
          diagnostics.push(
            `Step ${index + 1}: missing relationship/participant or incompatible architecture state`,
          );
          return [];
        }
        return [
          {
            ordinal: index + 1,
            relationshipId: relation.id,
            sourceId: relation.source,
            targetId: relation.target,
            description: step.description,
            technology: relation.technology,
            evidence: [{ sourceRef: ref, rule: 'c4/v1/step', explanation: relation.description }],
          },
        ];
      });
      if (!view.steps.length) diagnostics.push('The scenario has no authored steps');
      return {
        snapshotId: snapshot.id,
        c4Revision: model.revision,
        c4Hash: snapshot.c4Hash ?? '',
        viewId: view.id,
        title: view.title,
        state: view.state,
        steps,
        participants: [...new Set(steps.flatMap((step) => [step.sourceId, step.targetId]))],
        diagnostics,
      };
    });
}
