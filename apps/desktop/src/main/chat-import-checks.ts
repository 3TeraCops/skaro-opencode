import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore } from '@skaro/core';
import type { SkaroScope } from '@skaro/mcp-server';
import type { Item, SessionOptions } from '@skaro/timeline';
import { beforeEach, expect, it } from 'vitest';
import type { ChatSessions } from './chats';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
interface Context {
  dataDir: string;
  root: string;
  chats: ChatSessions;
  projectId: string;
  session: { received: string[] };
  started: SessionOptions | undefined;
  proposals: (chatId: string) => Promise<ProposalItem[]>;
  until: (check: () => boolean) => Promise<void>;
}

/** Existing import assertions; no new test service or session is created here. */
export function registerChatImportChecks(context: () => Context): void {
  let dataDir: string, root: string, chats: ChatSessions, projectId: string;
  let session: Context['session'], started: Context['started'];
  let proposals: Context['proposals'], until: Context['until'];
  beforeEach(() => {
    ({ dataDir, root, chats, projectId, session, started, proposals, until } = context());
  });
  it('imports documentation: copies the sources, stages artifacts and applies the picked', async () => {
    const docs = join(dataDir, 'docs');
    await mkdir(join(docs, 'adr'), { recursive: true });
    await writeFile(join(docs, 'README.md'), '# Shop\n\nМагазин.\n');
    await writeFile(join(docs, 'adr', 'queue.md'), '# Очередь\n\nBullMQ.\n');
    await writeFile(join(docs, 'flows.vsdx'), 'binary');
    await writeFile(join(docs, 'roles.csv'), 'роль,права\nowner,всё\n');

    const [source] = await chats.scanImport([docs]);
    expect(source).toMatchObject({ kind: 'folder', files: 4, readable: 3, formats: ['.vsdx'] });

    const chat = await chats.startImport(projectId, [docs], { agent: 'claude-code' });
    expect(chat.kind).toBe('import');
    await until(() => session.received.length === 1);
    started = context().started;
    expect(session.received[0]).toMatch(/^Импортировать документацию\n.+ · 4 файла$/);
    expect(started?.readDirs?.[0]).toContain('imports');
    const scope: SkaroScope = {
      kind: 'project_chat',
      projectId,
      chatId: chat.id,
      importId: 'x',
    };
    const manifest = JSON.parse(
      await readFile(join(started!.readDirs![0]!, 'manifest.json'), 'utf8'),
    ) as { files: { source: string; action: string; copy?: string }[] };
    expect(manifest.files.map((f) => f.action).sort()).toEqual([
      'converted',
      'copied',
      'copied',
      'skipped',
    ]);
    const table = manifest.files.find((f) => f.source.endsWith('roles.csv'))!;
    expect(await readFile(join(started!.readDirs![0]!, table.copy!), 'utf8')).toContain(
      '| owner | всё |',
    );

    await chats.stageArtifact(
      { type: 'brief', key: 'brief', body: '## Что строим\n\nМагазин.', sources: ['README.md'] },
      scope,
    );
    await chats.stageArtifact(
      {
        type: 'adr',
        key: 'adr-queue',
        title: 'Очередь задач',
        body: '## Решение\n\nBullMQ.',
        sources: ['adr/queue.md'],
      },
      scope,
    );
    await chats.stageArtifact(
      { type: 'milestone', key: 'm1', title: 'Возвраты', goal: 'Г', doneWhen: 'К', sources: [] },
      scope,
    );
    await chats.stageArtifact(
      {
        type: 'task',
        key: 't1',
        title: 'Возврат из заказа',
        goal: 'Через очередь {{adr-queue}}.',
        criteria: ['Работает'],
        milestone: 'm1',
        sources: ['code'],
      },
      scope,
    );
    await chats.stageArtifact(
      {
        type: 'task',
        key: 't2',
        title: 'Чек возврата',
        goal: 'Чек.',
        criteria: ['Есть чек'],
        dependsOn: ['t1', 'nope'],
        sources: ['code'],
      },
      scope,
    );
    const bad = await chats.finishImport({ skipped: [], notes: [] }, scope);
    expect(bad.isError).toBe(true);
    await chats.stageArtifact(
      {
        type: 'task',
        key: 't2',
        title: 'Чек возврата',
        goal: 'Чек.',
        criteria: ['Есть чек'],
        dependsOn: ['t1'],
        sources: ['code'],
      },
      scope,
    );
    await chats.finishImport({ skipped: [{ path: 'x.md', reason: 'дубликат' }], notes: [] }, scope);
    const [card] = await proposals(chat.id);
    expect(card?.proposal).toMatchObject({
      type: 'import',
      total: 5,
      skipped: 2,
      groups: [
        { kind: 'brief', count: 1 },
        { kind: 'adr', count: 1 },
        { kind: 'plan', count: 1, tasks: 2 },
      ],
    });
    const review = await chats.importReview(projectId, chat.id);
    expect(review.items.find((i) => i.key === 't1')?.refs.sort()).toEqual(['adr-queue', 'm1']);

    // The milestone is not taken: its task goes without one; the ADR link becomes its number.
    await chats.proposal(projectId, chat.id, card!.id, {
      action: 'apply',
      import: ['brief', 'adr-queue', 't1', 't2'],
    });
    const artifacts = await new ArtifactStore(root).load();
    expect(artifacts.brief?.body).toContain('Магазин.');
    expect(artifacts.adrs.map((a) => [a.id, a.title, a.status])).toEqual([
      ['0001', 'Очередь задач', 'accepted'],
    ]);
    const t1 = artifacts.tasks.find((t) => t.title === 'Возврат из заказа')!;
    const t2 = artifacts.tasks.find((t) => t.title === 'Чек возврата')!;
    expect(t1.milestone).toBeUndefined();
    expect(t1.body).toContain('Через очередь ADR-0001.');
    expect(t2.dependsOn).toEqual([t1.id]);
    expect(artifacts.milestones).toEqual([]);
    expect((await proposals(chat.id))[0]).toMatchObject({
      state: 'applied',
      result: { applied: 4 },
    });
  });
}
