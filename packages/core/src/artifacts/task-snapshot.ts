import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { ArtifactFiles } from './files.ts';
import type { Task } from './model.ts';
import { getFields, parseMarkdown } from './frontmatter.ts';
import { retainTaskId } from './task-ids.ts';

/** Restore one journalled task at its original path; the caller validates the whole graph. */
export async function restoreTaskSnapshot(
  files: ArtifactFiles,
  task: Task,
  content: string,
  expected: string | undefined,
): Promise<void> {
  const path = task.path.replaceAll('\\', '/');
  if (
    !path.startsWith('.skaro/tasks/') ||
    posix.dirname(path) !== '.skaro/tasks' ||
    !path.endsWith('.md')
  )
    throw new Error('A task snapshot must stay in its original task directory.');
  if (getFields(parseMarkdown(content)).id !== task.id)
    throw new Error('Task snapshot identity does not match its owner.');
  const current = await readFile(join(files.root, path), 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    },
  );
  if (current === content) return;
  if (current !== expected) throw new Error(`${task.id}: task file changed before restoration.`);
  await retainTaskId(files, task.id);
  await files.writeCreatedFile(path.slice('.skaro/'.length), content);
}
