import type { C4Relationship } from '../../packages/core/src/c4/model.ts';

const relations = [
  ['uses', 'owner', 'renderer', 'Работает с проектом', 'Desktop UI', 'apps/desktop/src/renderer/src/App.svelte'],
  ['ipc', 'renderer', 'main', 'Читает состояние и передаёт действия', 'Typed IPC', 'apps/desktop/src/main/session-handlers.ts'],
  ['persist', 'main', 'database', 'Сохраняет состояние приложения', 'SQLite', 'apps/desktop/src/main/app-services.ts'],
  ['codexsession', 'main', 'codex', 'Запускает сессии агента', 'Codex adapter', 'packages/adapter-codex/src/index.ts'],
  ['claudesession', 'main', 'claude', 'Запускает сессии агента', 'Claude adapter', 'packages/adapter-claude/src/index.ts'],
  ['gitops', 'main', 'git', 'Изолирует и публикует изменения', 'Git CLI', 'packages/core/src/git/git.ts'],
  ['environments', 'main', 'docker', 'Запускает штатные окружения задач', 'Docker Compose', 'docs/task-environments.md'],
  ['attachment', 'documents', 'c4viewer', 'Показывает вложенные C4-представления', 'Typed attachment', 'apps/desktop/src/renderer/src/docs/DocArticle.svelte'],
  ['model', 'c4service', 'c4domain', 'Проверяет и применяет архитектурный пакет', 'Domain API', 'apps/desktop/src/main/c4-service.ts'],
  ['packagejournal', 'c4service', 'database', 'Сохраняет пакет и решение владельца', 'AppDb settings', 'apps/desktop/src/main/c4-service.ts'],
  ['review', 'completion', 'c4service', 'Требует актуальную проверку архитектуры', 'C4 review', 'apps/desktop/src/main/completion-capture.ts'],
  ['realize', 'completion', 'c4domain', 'Переводит опубликованные изменения в текущую архитектуру', 'Domain API', 'apps/desktop/src/main/c4-publication.ts'],
  ['importmodel', 'imports', 'c4domain', 'Проверяет модель и документы импортируемого пакета', 'Domain API', 'apps/desktop/src/main/c4-import.ts'],
  ['importprepare', 'importstage', 'importpackage', 'Готовит согласованный пакет перед просмотром', 'TypeScript call', 'apps/desktop/src/main/chat-import-stage.ts'],
  ['serviceprepare', 'serviceclass', 'package', 'Готовит пакет', 'TypeScript call', 'apps/desktop/src/main/c4-service.ts'],
  ['serviceapply', 'serviceclass', 'transaction', 'Применяет решение владельца', 'TypeScript call', 'apps/desktop/src/main/c4-service.ts'],
  ['preparevalidate', 'package', 'validator', 'Проверяет семантическую модель', 'TypeScript call', 'packages/core/src/c4/package.ts'],
  ['coordinatorpublish', 'coordinator', 'publication', 'Публикует принятый результат', 'TypeScript call', 'apps/desktop/src/main/completion-coordinator.ts'],
  ['canvaslayout', 'canvas', 'layout', 'Запрашивает расположение узлов и связей', 'Worker message', 'apps/desktop/src/renderer/src/c4/layout.ts'],
  ['previewlayout', 'preview', 'layout', 'Использует ту же компоновку для превью', 'Worker message', 'apps/desktop/src/renderer/src/c4/C4Preview.svelte'],
  ['articlepreview', 'article', 'preview', 'Отображает C4-вложения', 'Svelte composition', 'apps/desktop/src/renderer/src/c4/C4Attachments.svelte'],
] as const;

export const skaroRelationships: C4Relationship[] = relations.map(([id, source, target, description, technology, path]) =>
  ({ id, source, target, description, technology, state: 'current', evidence: [path], decisions: [] }));
