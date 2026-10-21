import { readC4Model, validateC4Model, c4AtState, type C4Model } from '@skaro/core/c4-view';
import type { Facts, SourceFile } from '../facts';
import { projectC4Bindings } from './c4-bindings';
import { c4NodeId } from './c4-id';
export function projectC4(
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
): C4Model | null {
  const source = files.find((file) => file.path === '.skaro/c4/model.json');
  if (!source) return null;
  let model: C4Model;
  try {
    model = readC4Model(JSON.parse(source.text));
    const issues = validateC4Model(model);
    if (issues.length) throw new Error(issues.join('; '));
  } catch (error) {
    diagnostic(source.path, String(error));
    return null;
  }
  const ref = facts.ref(source);
  for (const state of ['current', 'planned'] as const) {
    const projected = c4AtState(model, state);
    for (const element of projected.elements) {
      if (state === 'current' && element.state !== 'current') continue;
      const id = c4NodeId(model, element.id, state);
      if (facts.nodes.has(id)) continue;
      facts.node({
        id,
        name: element.name,
        kind: 'architecture',
        origin: 'accepted-c4',
        state: id.startsWith('c4:planned:') ? 'planned' : 'current',
        sources: [ref],
        attributes: {
          c4Id: element.id,
          c4Kind: element.kind,
          description: element.description,
          technology: element.technology ?? '',
          external: element.external,
          code: element.code,
          questions: model.questions
            .filter((question) => question.affects.includes(element.id))
            .map((question) => question.question),
          parent: element.parent ? c4NodeId(model, element.parent, state) : '',
        },
      });
    }
    for (const element of projected.elements) {
      if (state === 'current' && element.state !== 'current') continue;
      const id = c4NodeId(model, element.id, state);
      if (element.parent) {
        const edge = facts.edge(
          c4NodeId(model, element.parent, state),
          id,
          'contains',
          ref,
          'c4/parent',
          'Explicit architectural containment',
          'accepted-c4',
          'explicit',
        );
        facts.edges.get(edge)!.state = facts.nodes.get(id)?.state;
      }
      for (const path of element.code) {
        const matches = files.filter(
          (file) => file.path === path || file.path.startsWith(path.replace(/\/$/, '') + '/'),
        );
        if (!matches.length)
          diagnostic(source.path, `${element.id}: code path is unavailable: ${path}`);
        for (const file of matches) {
          const edge = facts.edge(
            id,
            `file:${file.path}`,
            'references',
            ref,
            'c4/code',
            `Explicit C4 code mapping: ${path}; no symbol-level implementation claim`,
            'accepted-c4',
            'explicit',
          );
          facts.edges.get(edge)!.state = facts.nodes.get(id)?.state;
        }
      }
    }
    for (const relation of projected.relationships) {
      if (state === 'current' && relation.state !== 'current') continue;
      const sourceId = c4NodeId(model, relation.source, state),
        targetId = c4NodeId(model, relation.target, state);
      if (!facts.nodes.has(sourceId) || !facts.nodes.has(targetId)) continue;
      const planned =
        relation.state === 'planned' ||
        !!model.relationships.find((item) => item.id === relation.id)?.planned ||
        sourceId.startsWith('c4:planned:') ||
        targetId.startsWith('c4:planned:');
      const id = `c4:${state === 'planned' && planned ? 'planned:' : ''}${relation.id}`;
      facts.edges.set(id, {
        id,
        source: sourceId,
        target: targetId,
        kind: 'interacts',
        origin: 'accepted-c4',
        resolution: 'explicit',
        state: state === 'planned' && planned ? 'planned' : 'current',
        label: relation.description,
        evidence: [
          {
            sourceRef: ref,
            rule: 'c4/v1',
            explanation: `${relation.description}${relation.technology ? ` · ${relation.technology}` : ''}`,
          },
        ],
      });
    }
    for (const view of projected.views.filter(
      (view) => view.kind === 'deployment' && view.state === state,
    )) {
      for (const instance of view.instances) {
        const id = `c4:instance:${view.id}:${instance.id}`,
          element = facts.nodes.get(c4NodeId(model, instance.element, state));
        if (!element) continue;
        facts.node({
          ...element,
          id,
          kind: 'instance',
          state,
          attributes: { ...element.attributes, instance: instance.id, view: view.id },
        });
        facts.edge(
          c4NodeId(model, instance.node, state),
          id,
          'deploys',
          ref,
          'c4/instance',
          'Explicit deployment instance',
          'accepted-c4',
          'explicit',
        );
        facts.edge(
          id,
          element.id,
          'references',
          ref,
          'c4/instance-element',
          'Instance of this architectural element',
          'accepted-c4',
          'explicit',
        );
      }
      for (const link of view.instanceRelationships ?? []) {
        const id = (value: string) =>
          view.instances.some((instance) => instance.id === value)
            ? `c4:instance:${view.id}:${value}`
            : c4NodeId(model, value, state);
        const edge = facts.edge(
          id(link.source),
          id(link.target),
          'interacts',
          ref,
          `c4/instance-relationship/${link.relationship}`,
          'Explicit instance relationship',
          'accepted-c4',
          'explicit',
        );
        facts.edges.get(edge)!.state = state;
      }
    }
  }
  projectC4Bindings(model, files, facts, diagnostic);
  return model;
}
