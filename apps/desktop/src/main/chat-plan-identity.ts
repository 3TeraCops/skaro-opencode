import type { ProjectArtifacts, Task } from '@skaro/core';
import type { Item, ProposedTask } from '@skaro/timeline';
import type { ProposalItem } from './chat-model';
import { adrId } from './chat-proposal-helpers';
import type { PlanDecision } from './chat-plan-journal';

const localRef = (ref: string) => ref.replace(/^plan:[^:]+:/, '');
const title = (value: string) => value.trim().replace(/\s+/g, ' ');
const spec = (value?: string) => (value ? adrId(value) : undefined);
const sameRef = (a: string, b: string) =>
  a === b || ((!a.startsWith('plan:') || !b.startsWith('plan:')) && localRef(a) === localRef(b));

function destination(item: ProposalItem, task: ProposedTask): string | undefined {
  if (item.proposal.type !== 'plan') return undefined;
  const target = task.milestone ?? item.proposal.milestone;
  if (!target?.isNew) return target?.id;
  return item.result?.milestone?.id;
}

/** A ref alone is not identity: old logs can contain deleted/reused task numbers. */
function matches(
  task: Pick<ProposedTask, 'title' | 'spec'>,
  milestone: string | undefined,
  existing: Task,
): boolean {
  return (
    title(task.title) === title(existing.title) &&
    spec(task.spec) === spec(existing.spec) &&
    milestone === existing.milestone
  );
}

/** Recover proven bindings across legacy -> saved-plan namespaces, never guess from a title. */
export function reconcilePlanIdentity(
  item: ProposalItem,
  history: Item[],
  artifacts: ProjectArtifacts,
  creating?: PlanDecision['creating'],
): ProposalItem {
  if (item.proposal.type !== 'plan') return item;
  const created = [...(item.result?.tasks ?? [])];
  const written = creating && artifacts.tasks.find((t) => t.id === creating.id);
  if (written && creating && !created.some((t) => t.ref === creating.ref)) {
    if (!matches(creating.input, creating.input.milestone, written))
      throw new Error(`Reserved task ${written.id} does not match the approved creation.`);
    created.push({ id: written.id, title: written.title, ref: creating.ref });
  }
  const omitted = new Set(item.result?.omitted ?? []);
  const signatures = new Set<string>();
  for (const task of item.proposal.tasks) {
    const milestone = destination(item, task);
    const signature = JSON.stringify([title(task.title), spec(task.spec), milestone]);
    if (signatures.has(signature)) throw new Error(`Duplicate task in plan: "${task.title}".`);
    signatures.add(signature);
    const bound = created.find((t) => t.ref === task.ref);
    if (bound) {
      if (!artifacts.tasks.some((t) => t.id === bound.id))
        throw new Error(
          `Previously created task ${bound.id} is missing; reconcile the plan before creating tasks.`,
        );
      continue;
    }
    const candidates = new Set<string>();
    for (const previous of history) {
      if (
        previous.kind !== 'proposal' ||
        previous.id === item.id ||
        previous.proposal.type !== 'plan'
      )
        continue;
      for (const old of previous.proposal.tasks) {
        if (
          !sameRef(old.ref, task.ref) ||
          title(old.title) !== title(task.title) ||
          spec(old.spec) !== spec(task.spec) ||
          destination(previous, old) !== milestone
        )
          continue;
        const result = previous.result?.tasks?.find((t) => t.ref === old.ref);
        const existing = result && artifacts.tasks.find((t) => t.id === result.id);
        if (existing && matches(task, milestone, existing)) candidates.add(existing.id);
        if (previous.state === 'rejected' || previous.result?.omitted?.includes(old.ref))
          omitted.add(task.ref);
      }
    }
    if (candidates.size > 1)
      throw new Error(
        `Multiple existing tasks match "${task.title}": ${[...candidates].join(', ')}. Reconcile duplicates first.`,
      );
    const id = [...candidates][0];
    if (id) {
      created.push({ id, ref: task.ref, title: task.title });
      omitted.delete(task.ref);
    } else {
      const collisions = artifacts.tasks.filter((t) => matches(task, milestone, t));
      if (collisions.length)
        throw new Error(
          `Task "${task.title}" already exists (${collisions.map((t) => t.id).join(', ')}). Use existing task IDs in dependencies and omit it from new tasks; no duplicate was created.`,
        );
    }
  }
  return {
    ...item,
    result: { ...item.result, tasks: created, omitted: [...omitted] },
    state:
      item.state === 'pending' && created.length === item.proposal.tasks.length
        ? 'applied'
        : item.state,
  };
}
