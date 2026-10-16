import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ProjectToolHandlers } from './project-tool-model.ts';
import type { StageArtifactArgs, StagedArtifactType } from './project-tool-model.ts';
import { TASK_DECOMPOSITION_RULES } from './task-decomposition.ts';
import {
  guarded,
  text,
  optional,
  strings,
  record,
  inImport,
  ToolArgsError,
} from './project-tool-args.ts';

const STAGED_TYPES: StagedArtifactType[] = [
  'brief',
  'architecture',
  'adr',
  'spec',
  'doc',
  'milestone',
  'task',
];

export function importTools(handlers: ProjectToolHandlers): Tool<SkaroScope>[] {
  return [
    {
      name: 'stage_artifact',
      description:
        'Stage one artifact of the import in the Skaro format. Nothing is written to .skaro/: ' +
        'the user reviews everything and applies what they pick. Give every artifact a short ' +
        'unique "key"; refer to another staged artifact in any text as {{key}} and in the ' +
        'fields milestone, depends_on and spec by its key (Skaro puts the real numbers there). ' +
        'Types: brief and architecture (body; the architecture has a "Rules and constraints" ' +
        'section), adr (title, body with Context, Decision, Consequences), spec (title, body with ' +
        'Problem, Scenarios, Requirements R-1…, Out of scope, Open questions), doc (name, body: ' +
        'everything that fits no other type), milestone (title, goal, done_when), task (title, ' +
        'goal, criteria, notes, milestone, depends_on, spec). "sources": paths of the manifest ' +
        'the artifact comes from, "code" for the project code. To change an existing artifact ' +
        'instead of adding one, pass "updates": its ADR or specification number or document name ' +
        '(the brief and the architecture are changed when they exist). Staging the same key again ' +
        'replaces it.\n\nFor task artifacts:\n' +
        TASK_DECOMPOSITION_RULES,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: STAGED_TYPES },
          key: { type: 'string', description: 'Short unique key: adr-queue, spec-refunds, t1.' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Markdown text in the Skaro format.' },
          goal: { type: 'string', description: 'Milestone or task goal.' },
          done_when: { type: 'string', description: 'When the milestone counts as done.' },
          criteria: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task acceptance criteria: checkable statements.',
          },
          notes: { type: 'string', description: 'Task notes.' },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'Manifest source paths, or "code".',
          },
          updates: {
            type: 'string',
            description: 'Existing ADR or specification number (0003) or document name to change.',
          },
          status: { type: 'string', enum: ['proposed', 'accepted', 'superseded'] },
          milestone: {
            type: 'string',
            description: 'Task: key of a staged milestone or id (M02).',
          },
          depends_on: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task: keys of staged tasks or ids of existing tasks.',
          },
          spec: {
            type: 'string',
            description: 'Task: key of a staged specification or number of an existing one.',
          },
          name: { type: 'string', description: 'Document file name: glossary.md.' },
        },
        required: ['type', 'key', 'sources'],
        additionalProperties: false,
      },
      available: inImport,
      call: guarded(
        (a) => {
          const type = text(a, 'type') as StagedArtifactType;
          if (!STAGED_TYPES.includes(type)) {
            throw new ToolArgsError(`"type" must be one of ${STAGED_TYPES.join(', ')}.`);
          }
          const key = text(a, 'key');
          const need = (field: string) => {
            if (typeof a[field] !== 'string' || !(a[field] as string).trim()) {
              throw new ToolArgsError(`A ${type} needs "${field}".`);
            }
          };
          if (type === 'brief' || type === 'architecture') need('body');
          if (type === 'adr' || type === 'spec') {
            need('title');
            need('body');
          }
          if (type === 'doc') need('body');
          if (type === 'milestone') {
            need('title');
            need('goal');
            need('done_when');
          }
          if (type === 'task') {
            need('title');
            need('goal');
            if (!strings(a, 'criteria').length) {
              throw new ToolArgsError('A task needs "criteria".');
            }
          }
          if (type === 'doc' && !a['name'] && !a['updates'] && !a['title']) {
            throw new ToolArgsError('A document needs "name".');
          }
          const status = a['status'];
          return {
            type,
            key,
            ...optional(a, 'title'),
            ...optional(a, 'body'),
            ...optional(a, 'goal'),
            ...(typeof a['done_when'] === 'string' && a['done_when'].trim()
              ? { doneWhen: a['done_when'].trim() }
              : {}),
            ...(a['criteria'] !== undefined ? { criteria: strings(a, 'criteria') } : {}),
            ...optional(a, 'notes'),
            sources: strings(a, 'sources'),
            ...optional(a, 'updates'),
            ...(status === 'proposed' || status === 'accepted' || status === 'superseded'
              ? { status: status as NonNullable<StageArtifactArgs['status']> }
              : {}),
            ...optional(a, 'milestone'),
            ...(a['depends_on'] !== undefined ? { dependsOn: strings(a, 'depends_on') } : {}),
            ...optional(a, 'spec'),
            ...optional(a, 'name'),
          };
        },
        (args, scope) => handlers.stageArtifact(args, scope),
      ),
    },
    {
      name: 'finish_import',
      description:
        'Finish the import when everything that can be carried over is staged. List what was ' +
        'not carried over and why ("skipped": manifest path and reason: duplicate, empty, not ' +
        'about the project…), and the assumptions and contradictions you resolved ("notes"). ' +
        'The user then sees the "Import is ready" card and applies what they pick.',
      inputSchema: {
        type: 'object',
        properties: {
          skipped: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, reason: { type: 'string' } },
              required: ['path', 'reason'],
              additionalProperties: false,
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: [],
        additionalProperties: false,
      },
      available: inImport,
      call: guarded(
        (a) => ({
          skipped: Array.isArray(a['skipped'])
            ? a['skipped'].map((s, i) => {
                const item = record(s, `skipped[${i}]`);
                return { path: text(item, 'path'), reason: text(item, 'reason') };
              })
            : [],
          notes: a['notes'] === undefined ? [] : strings(a, 'notes'),
        }),
        (args, scope) => handlers.finishImport(args, scope),
      ),
    },
  ];
}
