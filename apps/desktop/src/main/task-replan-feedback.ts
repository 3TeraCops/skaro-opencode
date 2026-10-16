import type { TaskReplanProgress } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';

export function publishReplan(ctx: ChatEngine, live: LiveChat, item: ProposalItem): void {
  if (
    JSON.stringify(live.timeline.state.items.find((i) => i.id === item.id)) !== JSON.stringify(item)
  )
    ctx.history.skaroEvent(live, { t: 'item.upsert', item });
  ctx.history.flush(live);
}

export function replanProgress(
  ctx: ChatEngine,
  live: LiveChat,
  decision: TaskReplanDecision,
  value: TaskReplanProgress,
): void {
  decision.item = {
    ...decision.item,
    state: 'accepted',
    result: { ...decision.item.result, replan: value },
  };
  publishReplan(ctx, live, decision.item);
}

/** A stable identity keeps one outcome after replay or a crash between the journal and log. */
export function replanNotice(
  ctx: ChatEngine,
  live: LiveChat,
  item: ProposalItem,
  outcome: string,
  text: string,
  error = false,
): void {
  const id = `skaro-replan-${item.id}-${outcome}`;
  const previous = live.timeline.state.items.find((i) => i.id === id);
  if (previous?.kind === 'notice' && previous.text === text) return;
  ctx.history.skaroEvent(live, {
    t: 'item.upsert',
    item: {
      id,
      turnId: '',
      kind: 'notice',
      level: error ? 'error' : 'info',
      code: 'other',
      text,
      status: 'done',
      startedAt: previous?.startedAt ?? Date.now(),
      native: { agent: 'skaro', type: 'task_replan', ref: item.id },
    },
  });
  ctx.history.touch(live);
  ctx.history.flush(live);
}

export function reportReplanResult(
  ctx: ChatEngine,
  live: LiveChat,
  decision: TaskReplanDecision,
): void {
  const p = decision.item.proposal;
  if (p.type !== 'task_replan') throw new Error('Missing replan proposal.');
  const reverted = decision.phase === 'reverted';
  const outcome = reverted ? 'reverted' : 'applied';
  const ru = ctx.deps.locale() === 'ru';
  const counts = `${p.taskIds.length} → ${p.tasks.length}`;
  const text = reverted
    ? ru
      ? `Перепланирование отменено. Восстановлено задач: ${p.taskIds.length}.`
      : `Replan reverted: ${p.taskIds.length} original tasks restored.`
    : ru
      ? `Перепланирование завершено. Задачи: ${counts}.`
      : `Task replan completed: ${counts} tasks.`;
  publishReplan(ctx, live, decision.item);
  replanNotice(ctx, live, decision.item, outcome, text);
  if (decision.reported === outcome) return;
  if (decision.reported !== outcome) {
    const note = reverted
      ? `The owner reverted replan "${p.title}". Original tasks ${p.taskIds.join(', ')} are restored. Read the current graph; do not recreate or reapply this package.`
      : `The owner applied the entire replan "${p.title}". ${p.taskIds.join(', ')} now map to ${JSON.stringify(decision.ids)}. Do not create these tasks again.`;
    const pending = ctx.deps.db.getSetting<string[] | null>(`chat.${live.chat.id}.notes`, []) ?? [];
    if (!pending.includes(note)) ctx.proposals.addNotes(live.chat.id, [note]);
    ctx.deps.db.addEvent(live.projectId, reverted ? 'tasks_replan_reverted' : 'tasks_replanned', {
      proposal: decision.item.id,
      sources: p.taskIds,
      replacements: decision.ids,
    });
    decision.reported = outcome;
    new TaskReplanJournal(ctx.deps.db, live.projectId).save(decision);
  }
  ctx.project(live.projectId).invalidate();
  for (const taskId of new Set([
    ...decision.before.map((t) => t.id),
    ...Object.values(decision.ids),
  ]))
    ctx.deps.emit('task.changed', { projectId: live.projectId, taskId });
  ctx.deps.emit('project.changed', { projectId: live.projectId });
}

export function reportReplanFailure(
  ctx: ChatEngine,
  live: LiveChat,
  item: ProposalItem,
  operation: 'apply' | 'revert',
  error: unknown,
  started = false,
): void {
  const ru = ctx.deps.locale() === 'ru';
  const action =
    operation === 'apply' ? (ru ? 'Перепланирование' : 'Task replan') : ru ? 'Откат' : 'Revert';
  const message = error instanceof Error ? error.message : String(error);
  const title = item.proposal.type === 'task_replan' ? ` «${item.proposal.title}»` : '';
  const progress = item.result?.replan;
  const state =
    started && progress
      ? ru
        ? `Последний подтверждённый прогресс: записано ${progress.writes} из ${progress.totalWrites}; удалено ${progress.removes} из ${progress.totalRemoves}. Операция не завершена.`
        : `Last confirmed progress: written ${progress.writes} of ${progress.totalWrites}; removed ${progress.removes} of ${progress.totalRemoves}. The operation is incomplete.`
      : ru
        ? 'Файлы задач не изменены.'
        : 'Task files were not changed.';
  replanNotice(
    ctx,
    live,
    item,
    `error-${operation}`,
    `${action}${title}: ${state}\n${message}`,
    true,
  );
}
