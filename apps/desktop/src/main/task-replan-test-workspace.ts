import { git } from '@skaro/core';
import type { ReplanTasksArgs } from '@skaro/mcp-server';
import { planningWorkspace } from './chat-planning-test-workspace';
import { taskBody } from './task-body';
import type { ProposalItem } from './chat-model';
/** Owner-authorized isolated real SQLite, Git and ArtifactStore. No agent or fake backend. */
export async function replanWorkspace() {
  const w = await planningWorkspace();
  await git(w.store.root, ['init', '-q', '-b', 'main']);
  const a = await w.store.createTask({
    title: 'Обработка',
    spec: '0001',
    body: taskBody({ goal: 'Обработать запрос.', criteria: ['Запрос обрабатывается.'] }, 'ru'),
  });
  const b = await w.store.createTask({
    title: 'Документация',
    spec: '0001',
    dependsOn: [a.id],
    body: taskBody({ goal: 'Описать запрос.', criteria: ['Запрос документирован.'] }, 'ru'),
  });
  const c = await w.store.createTask({
    title: 'Использование',
    dependsOn: [b.id],
    body: taskBody({ goal: 'Использовать запрос.', criteria: ['Запрос используется.'] }, 'ru'),
  });
  const args: ReplanTasksArgs = {
    key: 'merge',
    title: 'Объединить обработку и документацию',
    taskIds: [a.id, b.id],
    tasks: [
      {
        ref: 'request',
        id: a.id,
        sources: [a.id, b.id],
        title: 'Обработать и документировать запрос',
        goal: 'Обработать запрос и описать его.',
        criteria: ['Запрос обрабатывается.', 'Запрос документирован.'],
        dependsOn: [],
        milestone: 'M02',
        order: 3,
      },
    ],
  };
  const offer = async (input = args) => {
    await w.engine.replans.propose(w.live, input);
    return w.engine.proposals.proposals(w.live).at(-1)!;
  };
  const apply = (item: ProposalItem) =>
    w.engine.proposals.proposal(w.live.projectId, w.live.chat.id, item.id, { action: 'apply' });
  return { ...w, a, b, c, args, offer, apply };
}
