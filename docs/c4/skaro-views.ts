import type { C4View } from '../../packages/core/src/c4/model.ts';

function view(id: string, kind: C4View['kind'], title: string, scope: string,
  elements: string[], relationships: string[]): C4View {
  return { id, kind, title, scope, state: 'current', elements, relationships, steps: [], instances: [] };
}

export const skaroViews: C4View[] = [
  view('context', 'context', 'Skaro в окружении владельца', 'skaro',
    ['owner', 'skaro', 'codex', 'claude', 'git', 'docker'], ['uses', 'codexsession', 'claudesession', 'gitops', 'environments']),
  view('containers', 'container', 'Устройство десктоп-приложения', 'skaro',
    ['owner', 'renderer', 'main', 'database', 'codex', 'claude', 'git', 'docker'],
    ['uses', 'ipc', 'persist', 'codexsession', 'claudesession', 'gitops', 'environments']),
  view('maincomponents', 'component', 'Архитектура и приёмка в main process', 'main',
    ['renderer', 'c4service', 'c4domain', 'completion', 'imports', 'database'], ['model', 'packagejournal', 'review', 'realize', 'importmodel']),
  view('renderercomponents', 'component', 'Документы и просмотр C4', 'renderer',
    ['documents', 'c4viewer', 'main'], ['attachment']),
  view('servicecode', 'code', 'Код сервиса C4', 'c4service', ['serviceclass', 'codereview'], []),
  view('domaincode', 'code', 'Код проверки и сохранения C4', 'c4domain', ['validator', 'package', 'transaction'], ['preparevalidate']),
  view('completioncode', 'code', 'Код публикации результата', 'completion', ['coordinator', 'publication'], ['coordinatorpublish']),
  view('importcode', 'code', 'Код согласования импорта', 'imports', ['importstage', 'importpackage'], ['importprepare']),
  view('viewercode', 'code', 'Код превью и холста', 'c4viewer', ['canvas', 'layout', 'preview'], ['canvaslayout', 'previewlayout']),
  view('documentscode', 'code', 'Код документа', 'documents', ['article'], []),
  { ...view('c4scenario', 'dynamic', 'Согласование и публикация C4', 'skaro',
    ['owner', 'renderer', 'c4service', 'c4domain', 'completion', 'database'],
    ['uses', 'model', 'packagejournal', 'review', 'realize']),
    steps: [
      { relationship: 'uses', description: 'Владелец обсуждает архитектуру и проверяет предложение' },
      { relationship: 'model', description: 'Сервис готовит согласованный пакет модели и документов' },
      { relationship: 'packagejournal', description: 'Сохраняется пакет и решение владельца' },
      { relationship: 'review', description: 'Перед приёмкой проверяются C4 и фактическая реализация' },
      { relationship: 'realize', description: 'Публикуются код и подтверждённая реализация архитектуры' },
    ] },
  { ...view('importscenario', 'dynamic', 'Проверка архитектуры импортируемых документов', 'skaro',
    ['imports', 'c4domain'], ['importmodel']),
    steps: [{ relationship: 'importmodel', description: 'Импорт разрешает ссылки и проверяет общую модель до предложения владельцу' }] },
  { ...view('deployment', 'deployment', 'Локальное развёртывание Skaro', 'skaro',
    ['main', 'renderer', 'database', 'host', 'mainprocess', 'rendererprocess', 'storage'], ['ipc', 'persist']),
    instances: [
      { id: 'maininstance', element: 'main', node: 'mainprocess' },
      { id: 'rendererinstance', element: 'renderer', node: 'rendererprocess' },
      { id: 'dbinstance', element: 'database', node: 'storage' },
    ] },
];
