import { ToolArgsError, text } from './project-tool-args.ts';
import type { ProposeSpecArgs } from './project-tool-model.ts';

export function readSpecC4(value: unknown): NonNullable<ProposeSpecArgs['c4']> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ToolArgsError('c4 must be an object');
  const args = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(args.base_revision) ||
    Number(args.base_revision) < 0 ||
    !Array.isArray(args.documents)
  )
    throw new ToolArgsError('c4 requires base_revision, model and documents');
  const documents = args.documents.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new ToolArgsError('c4.documents entries must be objects');
    return {
      path: text(entry as Record<string, unknown>, 'path'),
      content: text(entry as Record<string, unknown>, 'content'),
    };
  });
  return { baseRevision: Number(args.base_revision), model: args.model, documents };
}
