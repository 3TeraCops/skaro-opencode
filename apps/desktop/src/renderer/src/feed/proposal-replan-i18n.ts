import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'proposal.replan.applying': 'Применяет перепланирование…',
  'proposal.replan.reverting': 'Откатывает перепланирование…',
  'proposal.replan.progress':
    'Записано: {writes} из {totalWrites}; удалено: {removes} из {totalRemoves}',
  'proposal.replan.applied': 'Задачи перепланированы: {before} → {after}',
  'proposal.replan.reverted': 'Исходные задачи восстановлены: {after} → {before}',
  'proposal.replan.applyFailed': 'Перепланирование не завершено',
  'proposal.replan.revertFailed': 'Откат не завершён',
  'proposal.replan.openTasks': 'Открыть задачи',
  'proposal.replan.retry': 'Повторить',
});

addMessages('en', {
  'proposal.replan.applying': 'Applying task replan…',
  'proposal.replan.reverting': 'Reverting task replan…',
  'proposal.replan.progress':
    'Written: {writes} of {totalWrites}; removed: {removes} of {totalRemoves}',
  'proposal.replan.applied': 'Tasks replanned: {before} → {after}',
  'proposal.replan.reverted': 'Replan reverted: {after} → {before} tasks',
  'proposal.replan.applyFailed': 'Task replan is incomplete',
  'proposal.replan.revertFailed': 'Revert is incomplete',
  'proposal.replan.openTasks': 'Open tasks',
  'proposal.replan.retry': 'Retry',
});
