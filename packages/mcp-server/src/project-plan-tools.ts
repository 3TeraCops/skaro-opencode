import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ProjectToolHandlers } from './project-tool-model.ts';
import { guarded, text, optional, strings, inChat, TASK_SCHEMA } from './project-tool-args.ts';
import { parseMilestones, parseTasks } from './project-plan-args.ts';
import { TASK_DECOMPOSITION_RULES } from './task-decomposition.ts';

export function planTools(handlers: ProjectToolHandlers): Tool<SkaroScope>[] {
  return [
    {
      name: 'propose_milestones',
      description:
        'Propose milestones, optionally with implementation tasks and their dependencies. ' +
        'Batches containing more than one implementation task require prepare_plan. Propose new milestones with tasks: [], obtain acceptance, then save their full task plan. ' +
        'Use tasks: [] to create a milestone before its implementation tasks are ready. ' +
        'Prepare specifications in this project chat with propose_spec, never as coding tasks. ' +
        'For new functionality, propose tasks only after the specification is accepted and link it with spec. Each milestone becomes a ' +
        'card where the user picks the tasks to create; the tool returns at once, do not wait for ' +
        'the decision.\n\nTask boundaries:\n' +
        TASK_DECOMPOSITION_RULES,
      inputSchema: {
        type: 'object',
        properties: {
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                goal: { type: 'string', description: 'What the milestone achieves.' },
                done_when: { type: 'string', description: 'When the milestone counts as done.' },
                tasks: {
                  type: 'array',
                  items: TASK_SCHEMA,
                  description:
                    'Implementation tasks; use [] while specifications are prepared in the project chat.',
                },
              },
              required: ['title', 'goal', 'done_when', 'tasks'],
              additionalProperties: false,
            },
          },
        },
        required: ['milestones'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(parseMilestones, (args, scope) => handlers.proposeMilestones(args, scope)),
    },
    {
      name: 'propose_tasks',
      description:
        'Propose implementation tasks for an existing milestone (or without one). ' +
        'For a multi-task planning request use prepare_plan, propose_saved_plan and finish_plan to retain the full scope and verify completeness. ' +
        'Prepare specifications and task decomposition in this project chat, never by creating preparation tasks. ' +
        'For new functionality, first use propose_spec and obtain acceptance, then link each task with spec. ' +
        'Small fixes or improvements may omit spec. The user picks the tasks to ' +
        'create in a card; the tool returns at once, do not wait for the decision.\n\nTask boundaries:\n' +
        TASK_DECOMPOSITION_RULES,
      inputSchema: {
        type: 'object',
        properties: {
          milestone: { type: 'string', description: 'Id of an existing milestone (M02).' },
          tasks: { type: 'array', items: TASK_SCHEMA, minItems: 1 },
        },
        required: ['tasks'],
        additionalProperties: false,
      },
      available: inChat,
      call: guarded(parseTasks, (args, scope) => handlers.proposeTasks(args, scope)),
    },
  ];
}

export function updateTaskTool(handlers: ProjectToolHandlers): Tool<SkaroScope> {
  return {
    name: 'update_task',
    description:
      'Propose changes to an existing task: title, goal, criteria, notes, dependencies or ' +
      'milestone. Pass only what changes; criteria replace the whole list. The user accepts or ' +
      'rejects the change in a card; the tool returns at once.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id (T-012).' },
        title: { type: 'string' },
        goal: { type: 'string' },
        criteria: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        depends_on: { type: 'array', items: { type: 'string' } },
        milestone: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    available: inChat,
    call: guarded(
      (a) => ({
        id: text(a, 'id'),
        ...optional(a, 'title'),
        ...optional(a, 'goal'),
        ...optional(a, 'notes'),
        ...optional(a, 'milestone'),
        ...(a['criteria'] !== undefined ? { criteria: strings(a, 'criteria') } : {}),
        ...(a['depends_on'] !== undefined ? { dependsOn: strings(a, 'depends_on') } : {}),
      }),
      (args, scope) => handlers.updateTask(args, scope),
    ),
  };
}
