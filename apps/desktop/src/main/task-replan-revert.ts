import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskReplanProgress } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import { afterTask, matchesNew } from './task-replan-apply';
import { fingerprint } from './task-replan-guard';
import { taskFiles, restoredTaskText, plannedTaskText } from './task-replan-files';
import { assertRevertSafe, replanOriginals } from './task-replan-revert-guard';
import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';
import { taskReplanLockKey } from './project-task-mutations';
import { settingsKey } from './task-run-helpers';

/** Called under the project mutation gate. No intent/lock is changed until all checks pass. */
export async function beginReplanRevert(
  ctx: ChatEngine,
  decision: TaskReplanDecision,
): Promise<void> {
  if (decision.phase === 'reverting' || decision.phase === 'reverted') return;
  if (decision.phase === 'allocating')
    throw new Error(
      'Finish preparing the replan before reverting it. No task files have been changed.',
    );
  const { db } = ctx.deps;
  const context = ctx.project(decision.projectId);
  const lock = db.getSetting(taskReplanLockKey(decision.projectId), null);
  if (lock && lock !== decision.item.id) throw new Error('Another replan is still recovering.');
  const artifacts = await context.store.load();
  await assertRevertSafe(ctx, decision, artifacts);
  const originals = replanOriginals(decision);
  const touched = new Set([...decision.writes.map((w) => w.id), ...originals.map((t) => t.id)]);
  const files = await taskFiles(
    context.root,
    artifacts.tasks.filter((t) => touched.has(t.id)),
  );
  for (const write of decision.writes) {
    const current = artifacts.tasks.find((t) => t.id === write.id);
    const applied =
      current &&
      (write.before
        ? fingerprint(current) === fingerprint(afterTask(write.before, write.input))
        : matchesNew(current, write.input));
    const unchanged =
      decision.phase !== 'applied' &&
      (write.before ? current && fingerprint(current) === fingerprint(write.before) : !current);
    if (!applied && !unchanged)
      throw new Error(`${write.id}: changed since replanning; reverting would overwrite work.`);
    if (
      decision.afterFiles?.[write.id] !== undefined &&
      files[write.id] !== decision.afterFiles[write.id]
    )
      throw new Error(`${write.id}: task file changed since replanning.`);
    const expected = plannedTaskText(decision, write);
    if (
      current &&
      !decision.afterFiles?.[write.id] &&
      expected !== undefined &&
      files[write.id] !== expected &&
      !(decision.phase !== 'applied' && files[write.id] === decision.beforeFiles?.[write.id])
    )
      throw new Error(`${write.id}: task file changed since replanning.`);
  }
  for (const removed of decision.removes) {
    const current = artifacts.tasks.find((t) => t.id === removed.id);
    if (current && (decision.phase === 'applied' || fingerprint(current) !== fingerprint(removed)))
      throw new Error(`${removed.id}: a removed identity has been reused or edited.`);
    if (
      current &&
      decision.beforeFiles?.[removed.id] !== undefined &&
      files[removed.id] !== decision.beforeFiles[removed.id]
    )
      throw new Error(`${removed.id}: original task file changed since replanning.`);
  }
  const preferences: NonNullable<TaskReplanDecision['revert']>['preferences'] = {};
  for (const write of decision.writes.filter((w) => !w.before)) {
    const proposal = decision.item.proposal;
    if (proposal.type !== 'task_replan') throw new Error('Missing replan proposal.');
    const output = proposal.tasks.find((t) => decision.ids[t.ref] === write.id)!;
    const expected = decision.preferences?.[output.sources[0]!] ?? null;
    const current = db.getSetting(settingsKey(decision.projectId, write.id), null);
    if (fingerprint({ current }) !== fingerprint({ current: expected }))
      throw new Error(`${write.id}: agent settings changed since replanning.`);
    preferences[write.id] = { before: null, after: current };
  }
  decision.revert = {
    originals: originals.map((task) => ({
      task,
      before: decision.beforeFiles?.[task.id] ?? restoredTaskText(task, files[task.id]),
      ...(files[task.id] !== undefined ? { after: files[task.id] } : {}),
    })),
    created: artifacts.tasks
      .filter((t) => touched.has(t.id) && !originals.some((o) => o.id === t.id))
      .map((task) => ({ task, content: files[task.id]! })),
    preferences,
  };
  decision.phase = 'reverting';
  delete decision.error;
  new TaskReplanJournal(db, decision.projectId).save(decision);
  db.setSetting(taskReplanLockKey(decision.projectId), decision.item.id);
}

/** Recognize either side of each file write, including a crash before saving progress. */
export async function revertReplanWrites(
  ctx: ChatEngine,
  decision: TaskReplanDecision,
  progress?: (value: Omit<TaskReplanProgress, 'operation'>) => void,
): Promise<void> {
  const plan = decision.revert;
  if (!plan) throw new Error('The saved revert operation is missing.');
  const context = ctx.project(decision.projectId);
  const artifacts = await context.store.load();
  await assertRevertSafe(ctx, decision, artifacts);
  const currentFile = (path: string) =>
    readFile(join(context.root, path), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
  for (const original of plan.originals) {
    const current = artifacts.tasks.find((t) => t.id === original.task.id);
    if (current && current.path !== original.task.path)
      throw new Error(`${current.id}: task was moved during reverting.`);
    const text = await currentFile(original.task.path);
    if (text !== original.before && text !== original.after)
      throw new Error(`${original.task.id}: task changed during reverting.`);
  }
  for (const created of plan.created) {
    const current = artifacts.tasks.find((t) => t.id === created.task.id);
    if (
      current &&
      (current.path !== created.task.path || (await currentFile(current.path)) !== created.content)
    )
      throw new Error(`${created.task.id}: result changed during reverting.`);
  }
  for (const [id, saved] of Object.entries(plan.preferences)) {
    const current = ctx.deps.db.getSetting(settingsKey(decision.projectId, id), null);
    if (
      ![saved.before, saved.after].some(
        (value) => fingerprint({ value }) === fingerprint({ value: current }),
      )
    )
      throw new Error(`${id}: agent settings changed during reverting.`);
  }
  const counts = {
    writes: 0,
    totalWrites: plan.originals.length,
    removes: 0,
    totalRemoves: plan.created.length,
  };
  progress?.({ ...counts });
  for (const original of plan.originals) {
    await context.store.restoreReplannedTask(original.task, original.before, original.after);
    counts.writes++;
    progress?.({ ...counts });
  }
  for (const created of plan.created) {
    if (artifacts.tasks.some((t) => t.id === created.task.id))
      await context.store.deleteReplannedTask(
        created.task.id,
        plan.created.map((t) => t.task.id),
      );
    counts.removes++;
    progress?.({ ...counts });
  }
  for (const [id, saved] of Object.entries(plan.preferences))
    ctx.deps.db.setSetting(settingsKey(decision.projectId, id), saved.before);
  context.invalidate();
}
