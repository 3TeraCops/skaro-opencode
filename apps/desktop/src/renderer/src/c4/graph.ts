import type { Node, Edge } from '@xyflow/svelte';
import type { C4Element, C4Model, C4View } from '@skaro/core/c4-view';
import { ancestors, projectedEndpoint, c4AtState } from '@skaro/core/c4-view';

export interface C4NodeData extends Record<string, unknown> {
  element: C4Element;
  boundary: boolean;
  nameLines: string[];
  descriptionLines: string[];
  technologyLines: string[];
  instance?: string;
  plannedChange?: boolean;
}
export interface C4EdgeData extends Record<string, unknown> {
  relationship?: string;
  text: string;
  technology: string;
  textLines?: string[];
  technologyLines?: string[];
  labelHeight?: number;
  points: { x: number; y: number }[];
  labelPosition?: { x: number; y: number };
  lifeline?: boolean;
  planned?: boolean;
}
export type C4Node = Node<C4NodeData, 'c4'>;
export type C4Edge = Edge<C4EdgeData, 'c4'>;
export interface C4Graph {
  nodes: C4Node[];
  edges: C4Edge[];
}

function wrap(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current && measure(`${current} ${word}`) > width) {
      lines.push(current);
      current = '';
    }
    for (const char of word) {
      if (current && measure(current + char) > width) {
        lines.push(current);
        current = '';
      }
      current += char;
    }
    current += ' ';
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/** Stable semantic IDs; every node uses the same Skaro-owned dimensions and text rules. */
export function buildC4Graph(
  model: C4Model,
  view: C4View,
  measure: (text: string) => number,
): C4Graph {
  const plannedElements = new Set(
    view.state === 'planned' ? model.elements.filter((e) => e.planned).map((e) => e.id) : [],
  );
  const plannedRelations = new Set(
    view.state === 'planned' ? model.relationships.filter((r) => r.planned).map((r) => r.id) : [],
  );
  model = c4AtState(model, view.state);
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const displayed = new Set(view.elements);
  const boundary = new Set<string>();
  if (view.kind !== 'dynamic')
    for (const id of view.elements) {
      const parents = ancestors(id, byId).slice(1);
      const scoped = parents.indexOf(view.scope);
      for (const parent of view.kind === 'deployment'
        ? parents
        : scoped < 0
          ? []
          : parents.slice(0, scoped + 1)) {
        if (view.kind === 'deployment' && byId.get(parent)?.kind !== 'deployment-node') continue;
        boundary.add(parent);
      }
    }
  for (const id of boundary) displayed.add(id);
  const nodes: C4Node[] = [];
  const add = (
    id: string,
    element: C4Element,
    group: boolean,
    parentId?: string,
    instance?: string,
  ) => {
    const nameLines = wrap(element.name, 216, measure);
    const descriptionLines = wrap(element.description, 216, (text) => (measure(text) * 12) / 14);
    const technologyLines = wrap(
      element.technology ?? '',
      216,
      (text) => (measure(text) * 11) / 14,
    );
    nodes.push({
      id,
      type: 'c4',
      position: { x: 0, y: 0 },
      width: 248,
      height: group
        ? 52 + nameLines.length * 19
        : 46 +
          nameLines.length * 19 +
          descriptionLines.length * 17 +
          technologyLines.length * 15 +
          (technologyLines.length ? 18 : 12),
      ...(parentId ? { parentId } : {}),
      draggable: false,
      connectable: false,
      data: {
        element,
        boundary: group,
        nameLines,
        descriptionLines,
        technologyLines,
        ...(instance ? { instance } : {}),
        plannedChange: plannedElements.has(element.id),
      },
    });
  };
  const visit = (parent?: string) => {
    for (const element of model.elements.filter((e) => e.parent === parent)) {
      if (
        displayed.has(element.id) &&
        !(view.kind === 'deployment' && element.kind === 'container')
      ) {
        const parentId =
          view.kind === 'dynamic'
            ? undefined
            : ancestors(element.id, byId)
                .slice(1)
                .find((id) => displayed.has(id));
        add(
          element.id,
          element,
          boundary.has(element.id) || element.kind === 'deployment-node',
          parentId,
        );
      }
      visit(element.id);
    }
  };
  visit();
  if (view.kind === 'deployment')
    for (const instance of view.instances)
      add(instance.id, byId.get(instance.element)!, false, instance.node, instance.id);
  const edges: C4Edge[] = [];
  const relationIds =
    view.kind === 'dynamic' ? view.steps.map((s) => s.relationship) : view.relationships;
  relationIds.forEach((id, index) => {
    const rel = model.relationships.find((r) => r.id === id)!;
    const source = projectedEndpoint(model, view.elements, rel.source)!;
    const target = projectedEndpoint(model, view.elements, rel.target)!;
    const from =
      view.kind === 'deployment'
        ? model.elements.find((e) => e.id === source)?.kind === 'deployment-node'
          ? [source]
          : view.instances.filter((i) => i.element === source).map((i) => i.id)
        : [source];
    const to =
      view.kind === 'deployment'
        ? model.elements.find((e) => e.id === target)?.kind === 'deployment-node'
          ? [target]
          : view.instances.filter((i) => i.element === target).map((i) => i.id)
        : [target];
    const links =
      view.kind === 'deployment'
        ? view.instanceRelationships?.filter((link) => link.relationship === id)
        : [];
    const pairs = links?.length
      ? links.map((link) => [link.source, link.target] as const)
      : from.flatMap((a) => to.map((b) => [a, b] as const));
    for (const [a, b] of pairs)
      edges.push({
        id: `${id}-${index}-${a}-${b}`,
        source: a,
        target: b,
        type: 'c4',
        selectable: true,
        data: {
          relationship: id,
          planned: rel.state === 'planned' || plannedRelations.has(id),
          text:
            view.kind === 'dynamic'
              ? `${index + 1}. ${view.steps[index]!.description}`
              : rel.description,
          technology: rel.technology,
          textLines: wrap(
            view.kind === 'dynamic'
              ? `${index + 1}. ${view.steps[index]!.description}`
              : rel.description,
            204,
            (text) => (measure(text) * 11) / 14,
          ),
          technologyLines: wrap(rel.technology, 204, (text) => (measure(text) * 10) / 14),
          points: [],
        },
      });
  });
  for (const edge of edges)
    edge.data!.labelHeight =
      10 + edge.data!.textLines!.length * 15 + edge.data!.technologyLines!.length * 13;
  return { nodes, edges };
}
