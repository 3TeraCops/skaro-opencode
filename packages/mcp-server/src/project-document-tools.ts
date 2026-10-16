import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ProjectToolHandlers } from './project-tool-model.ts';
import { guarded, text, optional, inChat, ToolArgsError } from './project-tool-args.ts';
import { readSpecC4 } from './spec-c4-args.ts';

export function documentTools(handlers: ProjectToolHandlers): Tool<SkaroScope>[] {
  return [
    {
      name: 'write_doc',
      description:
        'Write a whole project document: the brief (brief.md), the architecture ' +
        '(architecture.md, with a "Rules and constraints" section the coding agents must follow) ' +
        'or a free document (docs/<name>.md). Pass the complete new text, not a patch. The user ' +
        'sees the change as a card; depending on the project setting it is applied at once or ' +
        'after the user accepts it. The result tells you which.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'brief.md, architecture.md or docs/<name>.md (lowercase, dashes).',
          },
          content: { type: 'string', description: 'The full Markdown text of the document.' },
          summary: { type: 'string', description: 'One sentence: what changed and why.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => ({
          path: text(a, 'path').replace(/^\.skaro\//, ''),
          content: text(a, 'content'),
          ...optional(a, 'summary'),
        }),
        (args, scope) => handlers.writeDoc(args, scope),
      ),
    },
    {
      name: 'propose_adr',
      description:
        'Propose an architecture decision record. The user accepts, edits or rejects it in a ' +
        'card; the tool returns at once, do not wait for the decision. Propose an ADR for ' +
        'decisions that are costly to change later.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The decision in a few words.' },
          context: { type: 'string', description: 'The problem and the forces at play.' },
          decision: { type: 'string', description: 'What is decided.' },
          consequences: { type: 'string', description: 'What follows, good and bad.' },
          replaces: { type: 'string', description: 'Id of an ADR this one replaces (0004).' },
          summary: { type: 'string', description: 'One or two sentences for the card.' },
        },
        required: ['title', 'context', 'decision', 'consequences'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => ({
          title: text(a, 'title'),
          context: text(a, 'context'),
          decision: text(a, 'decision'),
          consequences: text(a, 'consequences'),
          ...optional(a, 'replaces'),
          ...optional(a, 'summary'),
        }),
        (args, scope) => handlers.proposeAdr(args, scope),
      ),
    },
    {
      name: 'propose_spec',
      description:
        'Include c4 (base_revision, complete model and other related documents) to propose a specification together with its C4 coverage in ONE owner decision. Read get_c4_context first. For multiple specifications use propose_c4 directly. ' +
        'Prepare and propose a specification directly in this project chat, before its implementation tasks are cut. ' +
        'Do not delegate specification preparation to a coding task. Pass the whole ' +
        'Markdown text with the sections Problem, Scenarios, Requirements (numbered R-1, R-2…), ' +
        'Out of scope and Open questions. Without "id" it is a new specification: the user ' +
        'accepts, edits or rejects it in a card. With "id" it is a change to an existing one, ' +
        'shown with its diff; it applies at once or after the user accepts it, depending on the ' +
        'project setting. The tool returns at once, do not wait for the decision.',
      inputSchema: {
        type: 'object',
        properties: {
          c4: {
            type: 'object',
            properties: {
              base_revision: { type: 'integer', minimum: 0 },
              model: { type: 'object' },
              documents: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { path: { type: 'string' }, content: { type: 'string' } },
                  required: ['path', 'content'],
                  additionalProperties: false,
                },
              },
            },
            required: ['base_revision', 'model', 'documents'],
            additionalProperties: false,
          },
          id: {
            type: 'string',
            description: 'Number of an existing specification to change (0003).',
          },
          title: { type: 'string', description: 'The function in a few words (new ones).' },
          content: { type: 'string', description: 'The full Markdown text.' },
          replaces: {
            type: 'string',
            description: 'Number of a specification this new one replaces (0001).',
          },
          summary: { type: 'string', description: 'One or two sentences for the card.' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(
        (a) => {
          const id = optional(a, 'id');
          const title = optional(a, 'title');
          if (!id.id && !title.title) {
            throw new ToolArgsError('"title" is required for a new specification.');
          }
          return {
            ...(a.c4 ? { c4: readSpecC4(a.c4) } : {}),
            ...id,
            ...title,
            content: text(a, 'content'),
            ...optional(a, 'replaces'),
            ...optional(a, 'summary'),
          };
        },
        (args, scope) => handlers.proposeSpec(args, scope),
      ),
    },
  ];
}
