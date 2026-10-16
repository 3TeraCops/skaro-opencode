import type { C4Element } from '../../packages/core/src/c4/model.ts';

function element(id: string, kind: C4Element['kind'], name: string, description: string,
  path: string, parent?: string, technology?: string, external = false): C4Element {
  return { id, kind, name, description, state: 'current', external,
    ...(parent ? { parent } : {}), ...(technology ? { technology } : {}),
    code: path ? [path] : [], evidence: [path || 'docs/architecture.md'], decisions: [] };
}

/** Documentation of the actual repository, also used for native browser verification. */
export const skaroElements: C4Element[] = [
  element('owner', 'person', 'Владелец проекта', 'Обсуждает проект, принимает документацию и результаты реализации.', '', undefined, undefined, true),
  element('skaro', 'system', 'Skaro', 'Локальное управление проектом, документацией, агентами и реализацией задач.', 'docs/architecture.md'),
  element('codex', 'system', 'Codex CLI', 'Исполняет сессии агента через адаптер Skaro.', 'packages/adapter-codex/src/index.ts', undefined, undefined, true),
  element('claude', 'system', 'Claude Code', 'Исполняет сессии агента через адаптер Skaro.', 'packages/adapter-claude/src/index.ts', undefined, undefined, true),
  element('git', 'system', 'Git', 'Хранит историю кода, ветки, worktree и атомарную публикацию результатов.', 'packages/core/src/git/git.ts', undefined, undefined, true),
  element('docker', 'system', 'Docker', 'Запускает предусмотренные проектом окружения задач.', 'docs/task-environments.md', undefined, undefined, true),
  element('main', 'container', 'Desktop main', 'Обслуживает IPC, артефакты проекта, MCP, сессии агентов и публикацию.', 'apps/desktop/src/main/app-services.ts', 'skaro', 'Electron · TypeScript'),
  element('renderer', 'container', 'Desktop renderer', 'Показывает документы, холст C4, ленту, план и задачи.', 'apps/desktop/src/renderer/src/App.svelte', 'skaro', 'Svelte 5 · Chromium'),
  element('database', 'container', 'AppDb', 'Сохраняет проекты, сессии, решения владельца и журналы операций.', 'packages/core/src/db/appdb.ts', 'skaro', 'SQLite · node:sqlite'),
  element('c4service', 'component', 'C4Service', 'Готовит архитектурные пакеты, принимает решения и сохраняет проверку кода.', 'apps/desktop/src/main/c4-service.ts', 'main', 'TypeScript'),
  element('c4domain', 'component', 'C4 domain', 'Проверяет общую модель, покрытие требований, проекции и согласованную запись файлов.', 'packages/core/src/c4/index.ts', 'main', 'TypeScript · JSON · Markdown'),
  element('completion', 'component', 'Завершение задач', 'Фиксирует проверенный результат, собирает кандидат и публикует код с метаданными.', 'apps/desktop/src/main/completion-coordinator.ts', 'main', 'TypeScript · Git'),
  element('imports', 'component', 'Импорт документов', 'Согласует исходные документы, ссылки и модель C4 перед принятием импорта.', 'apps/desktop/src/main/chat-import-stage.ts', 'main', 'TypeScript'),
  element('c4viewer', 'component', 'Просмотр C4', 'Строит превью и интерактивный холст с единым видом диаграмм.', 'apps/desktop/src/renderer/src/c4/C4Viewer.svelte', 'renderer', 'Svelte Flow · ELK'),
  element('documents', 'component', 'Документы', 'Показывает и редактирует архитектуру, спецификации, ADR и прочие документы.', 'apps/desktop/src/renderer/src/docs/DocsScreen.svelte', 'renderer', 'Svelte 5 · Markdown'),
  element('serviceclass', 'code', 'C4Service', 'Проверяет вызывающую сессию и управляет пакетами C4.', 'apps/desktop/src/main/c4-service.ts', 'c4service', 'TypeScript class'),
  element('codereview', 'code', 'assertC4TaskReview', 'Проверяет актуальность модели, документации и отпечатка реализации.', 'apps/desktop/src/main/c4-review.ts', 'c4service', 'TypeScript function'),
  element('validator', 'code', 'validateC4Model', 'Проверяет идентификаторы, иерархию, состояния и представления.', 'packages/core/src/c4/validate.ts', 'c4domain', 'TypeScript function'),
  element('package', 'code', 'prepareC4Package', 'Готовит полный согласованный diff документов и модели.', 'packages/core/src/c4/package.ts', 'c4domain', 'TypeScript function'),
  element('transaction', 'code', 'applyC4Package', 'Записывает подтверждённый пакет с журналом и восстановлением.', 'packages/core/src/c4/transaction.ts', 'c4domain', 'TypeScript function'),
  element('coordinator', 'code', 'CompletionCoordinator', 'Координирует принятие и публикацию результатов задач.', 'apps/desktop/src/main/completion-coordinator.ts', 'completion', 'TypeScript class'),
  element('publication', 'code', 'publishCompletion', 'Публикует код и подтверждённую реализацию планируемой архитектуры.', 'apps/desktop/src/main/completion-publication.ts', 'completion', 'TypeScript function'),
  element('importstage', 'code', 'ChatImportStage', 'Сохраняет и проверяет подготовленный агентом импорт.', 'apps/desktop/src/main/chat-import-stage.ts', 'imports', 'TypeScript class'),
  element('importpackage', 'code', 'prepareImportC4', 'Разрешает номера и ссылки документов в согласованном пакете C4.', 'apps/desktop/src/main/c4-import.ts', 'imports', 'TypeScript function'),
  element('canvas', 'code', 'C4Canvas', 'Обрабатывает масштабирование, перемещение, выбор и фокус на холсте.', 'apps/desktop/src/renderer/src/c4/C4Canvas.svelte', 'c4viewer', 'Svelte component'),
  element('layout', 'code', 'ELK worker', 'Рассчитывает иерархическую компоновку и маршруты связей вне UI-потока.', 'apps/desktop/src/renderer/src/c4/layout-engine.ts', 'c4viewer', 'Web Worker · ELK'),
  element('preview', 'code', 'C4Preview', 'Показывает превью во всю ширину и открывает просмотрщик.', 'apps/desktop/src/renderer/src/c4/C4Preview.svelte', 'c4viewer', 'Svelte · SVG'),
  element('article', 'code', 'DocArticle', 'Собирает документ из безопасных Markdown-блоков и C4-вложений.', 'apps/desktop/src/renderer/src/docs/DocArticle.svelte', 'documents', 'Svelte component'),
  element('host', 'deployment-node', 'Компьютер владельца', 'Локально запускает Skaro и инструменты проекта.', '', undefined, 'Windows · macOS · Linux'),
  element('mainprocess', 'deployment-node', 'Main process', 'Выполняет backend десктоп-приложения.', 'apps/desktop/src/main/index.ts', 'host', 'Electron · Node.js'),
  element('rendererprocess', 'deployment-node', 'Renderer process', 'Выполняет интерфейс с изоляцией от Node.js.', 'apps/desktop/src/main/app-window.ts', 'host', 'Chromium · contextIsolation'),
  element('storage', 'deployment-node', 'Локальное хранилище', 'Сохраняет AppDb в пользовательском каталоге приложения.', 'apps/desktop/src/main/state.ts', 'host', 'Filesystem · SQLite'),
];
