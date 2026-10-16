import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { git } from '@skaro/core';
import type { ProjectContext } from './projects';
import type { IntegrationOperation } from './integration-model';

/** A persisted path is admitted only when it still belongs to this repository. */
export async function admitIntegration(
  context: ProjectContext,
  op: IntegrationOperation,
  checkpoint: (op: IntegrationOperation) => void,
) {
  if (!existsSync(op.worktree)) {
    if (op.cursor || op.needsVerification || op.commitIntent)
      throw new Error('The saved integration checkout is missing.');
    await mkdir(dirname(op.worktree), { recursive: true });
    await context.git.createDetachedWorktree(op.worktree, op.baseHead);
  }
  const common = async (cwd: string) =>
    realpath(resolve(cwd, (await git(cwd, ['rev-parse', '--git-common-dir'])).stdout.trim()));
  if ((await common(op.worktree)) !== (await common(context.root)))
    throw new Error('The saved integration checkout belongs to a different repository.');
  if ((await git(op.worktree, ['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true })).code === 0)
    throw new Error('An integration checkout must remain detached from source branches.');
  if (op.commitIntent) {
    const intent = op.commitIntent;
    const head = await context.git.head('HEAD', op.worktree);
    if (head !== intent.before && head !== intent.head)
      throw new Error('Integration commit was changed externally.');
    if ((await git(op.worktree, ['write-tree'])).stdout.trim() !== intent.tree)
      throw new Error('The staged resolution changed after its commit checkpoint.');
    if (head === intent.before)
      await git(op.worktree, ['update-ref', 'HEAD', intent.head, intent.before]);
    await git(op.worktree, ['update-ref', `refs/skaro/integrations/${op.id}`, intent.head]);
    if (await mergeHead(op.worktree)) await git(op.worktree, ['merge', '--quit']);
    op.head = intent.head;
    op.cursor = intent.cursor;
    op.commitIntent = undefined;
    checkpoint(op);
  }
  if ((await context.git.head('HEAD', op.worktree)) !== op.head)
    throw new Error('The saved integration HEAD changed outside its operation.');
}

export async function unmergedFiles(worktree: string): Promise<string[]> {
  return (await git(worktree, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout
    .split('\0')
    .filter(Boolean);
}

export async function mergeHead(worktree: string): Promise<string | undefined> {
  const value = await git(worktree, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
    allowFail: true,
  });
  return value.code === 0 ? value.stdout.trim() : undefined;
}

/** Service commits include the resolved Git index; the agent never commits or rewrites inputs. */
export async function commitIntegration(
  op: IntegrationOperation,
  checkpoint: (op: IntegrationOperation) => void,
): Promise<string> {
  if ((await unmergedFiles(op.worktree)).length)
    throw new Error('Unresolved files remain in the index.');
  const dirty = await git(op.worktree, ['diff', '--quiet'], { allowFail: true });
  if (dirty.code !== 0)
    throw new Error('Stage all resolution edits before verifying the integration.');
  const metadata = await git(op.worktree, ['diff', '--cached', '--name-only', '--', '.skaro']);
  if (metadata.stdout.trim()) throw new Error('The resolver must not change .skaro metadata.');
  const input = await mergeHead(op.worktree);
  const staged = await git(op.worktree, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (!input && staged.code === 0) return op.head;
  const tree = (await git(op.worktree, ['write-tree'])).stdout.trim();
  const parents = ['-p', op.head, ...(input ? ['-p', input] : [])];
  const head = (
    await git(op.worktree, [
      'commit-tree',
      tree,
      ...parents,
      '-m',
      ':twisted_rightwards_arrows: merge: integrate accepted results',
    ])
  ).stdout.trim();
  op.commitIntent = { before: op.head, head, tree, cursor: op.cursor + (input ? 1 : 0), input };
  checkpoint(op);
  await git(op.worktree, ['update-ref', `refs/skaro/integrations/${op.id}`, head]);
  await git(op.worktree, ['update-ref', 'HEAD', head, op.head]);
  if (input) await git(op.worktree, ['merge', '--quit']);
  op.cursor = op.commitIntent.cursor;
  op.head = head;
  op.commitIntent = undefined;
  checkpoint(op);
  return head;
}
