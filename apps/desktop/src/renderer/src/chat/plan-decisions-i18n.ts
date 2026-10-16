import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'proposal.plan.complete': '{title} · {tasks}',
  'proposal.plan.defaultTitle': 'План',
  'proposal.plan.confirm': 'Подтвердить план',
  'proposal.plan.confirmHint': 'К созданию: {tasks} со всеми связями',
  'proposal.plan.creating': 'Создаём задачи плана…',
  'proposal.plan.selectionHint':
    'Выбор задачи включает её зависимости. Снятие зависимости снимает связанные задачи.',
  'proposal.plan.created': 'Создана {id}',
  'proposal.plan.declined': 'Не выбрана',
  'proposal.plan.cancelled': 'Создано: {done} · остальные задачи отменены',
  'proposal.plan.cancelledMilestone':
    'Создан этап {id} · задач: {done} · остальные задачи отменены',
});
addMessages('en', {
  'proposal.plan.complete': '{title} · {tasks}',
  'proposal.plan.defaultTitle': 'Plan',
  'proposal.plan.confirm': 'Confirm plan',
  'proposal.plan.confirmHint': 'Create {tasks} with all dependencies',
  'proposal.plan.creating': 'Creating plan tasks…',
  'proposal.plan.selectionHint':
    'Selecting a task includes its prerequisites. Removing a prerequisite removes dependent tasks.',
  'proposal.plan.created': 'Created {id}',
  'proposal.plan.declined': 'Not selected',
  'proposal.plan.cancelled': 'Created: {done} · remaining tasks cancelled',
  'proposal.plan.cancelledMilestone':
    'Created milestone {id} · tasks: {done} · remaining tasks cancelled',
});
