import {
  displayStatus,
  indexTasks,
  authoredBody,
  type ProjectArtifacts,
  type Task,
} from '@skaro/core';

/** What get_project_context returns: the whole project in one Markdown text. */
export function projectContextText(
  name: string,
  artifacts: ProjectArtifacts,
  runtime: Map<string, { state: Parameters<typeof displayStatus>[2] }>,
): string {
  const index = indexTasks(artifacts.tasks);
  const lines: string[] = [`# Project ${name}`.trim(), ''];
  const doc = (title: string, path: string, body: string | undefined) => {
    lines.push(`## ${title} (.skaro/${path})`, '', body?.trim() || '(not written yet)', '');
  };
  doc('Brief', 'brief.md', artifacts.brief?.body);
  doc(
    'Architecture',
    'architecture.md',
    artifacts.architecture ? authoredBody(artifacts.architecture.body) : undefined,
  );
  lines.push(
    '## C4 architecture coverage',
    '',
    JSON.stringify({
      revision: artifacts.c4?.revision ?? 0,
      problems: artifacts.c4Problems ?? [],
      specifications: artifacts.c4?.specifications.map((s) => ({
        id: s.id,
        impact: s.impact,
        elements: s.elements,
        views: s.views,
      })),
      instruction:
        'Call get_c4_context for the complete model/schema, source documents, pending packages and code review fingerprint.',
    }),
    '',
  );
  lines.push('## ADRs', '');
  if (!artifacts.adrs.length) lines.push('(none)');
  for (const adr of artifacts.adrs) {
    lines.push(`- ADR-${adr.id} ${adr.title} — ${adr.status} (${adr.path})`);
  }
  lines.push('', '## Specifications', '');
  if (!artifacts.specs.length) lines.push('(none)');
  for (const spec of artifacts.specs) {
    lines.push(`- SPEC-${spec.id} ${spec.title} — ${spec.status} (${spec.path})`);
  }
  lines.push('', '## Documents', '');
  if (!artifacts.docs.length) lines.push('(none)');
  for (const d of artifacts.docs) lines.push(`- ${d.title} (${d.path})`);
  lines.push('', '## Milestones and tasks', '');
  const taskLine = (t: Task) => {
    const status = displayStatus(t, index, runtime.get(t.id)?.state);
    const deps = t.dependsOn.length ? `; depends on ${t.dependsOn.join(', ')}` : '';
    const spec = t.spec ? `; implements SPEC-${t.spec}` : '';
    return `- ${t.id} ${t.title} — ${status}${deps}${spec}${t.archived ? '; archived' : ''}`;
  };
  for (const m of artifacts.milestones) {
    lines.push(`### ${m.id} ${m.title}`, '');
    const tasks = artifacts.tasks.filter((t) => t.milestone === m.id);
    lines.push(...(tasks.length ? tasks.map(taskLine) : ['(no tasks)']), '');
  }
  const loose = artifacts.tasks.filter((t) => !t.milestone);
  if (loose.length) lines.push('### Without a milestone', '', ...loose.map(taskLine), '');
  if (!artifacts.milestones.length && !loose.length) lines.push('(none)', '');
  lines.push(
    `Documents from the chat ${artifacts.config.chat.autoAcceptDocs ? 'apply at once' : 'wait for the user to accept them'}.`,
  );
  return lines.join('\n');
}
