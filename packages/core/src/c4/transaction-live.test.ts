import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model.ts';
import { skaroC4Specification } from '../../../../docs/c4/skaro-specification.ts';
import { ArtifactStore } from '../artifacts/store.ts';
import { prepareC4Package } from './package.ts';
import { applyC4Package, recoverC4Transaction } from './transaction.ts';
import { c4Hash } from './documents.ts';
import type { C4Package } from './model.ts';

const root = process.env['SKARO_C4_VERIFY_ROOT'];
const source = new URL('../../../../', import.meta.url);

// Opt-in against a genuine checkout of the same repository. No fake code or services.
it.skipIf(!root)(
  'writes a coherent package, refuses an owner edit and recovers an actual interrupted writer',
  async () => {
    const architecture = await readFile(new URL('docs/architecture.md', source), 'utf8');
    const specification = await readFile(new URL('docs/c4/specification.md', source), 'utf8');
    const model = structuredClone(skaroC4);
    const store = new ArtifactStore(root!);
    const existing = await store.load();
    const baseRevision = existing.c4?.revision ?? 0;
    model.revision = baseRevision + 1;
    const originalModel = await readFile(join(root!, '.skaro/c4/model.json'), 'utf8').catch(
      () => null,
    );
    model.specifications = [skaroC4Specification(specification)];
    const initial = await prepareC4Package(root!, {
      title: 'C4 Skaro',
      summary: 'Архитектура и требования C4 по реальному коду Skaro.',
      baseRevision,
      model,
      locale: 'ru',
      documents: [
        { path: 'architecture.md', content: architecture },
        {
          path: 'specs/0001-c4.md',
          content: `---\nid: "0001"\ntitle: C4 в Skaro\nstatus: accepted\n---\n${specification}`,
        },
      ],
    });
    expect(await readFile(join(root!, '.skaro/c4/model.json'), 'utf8').catch(() => null)).toBe(
      originalModel,
    );
    await applyC4Package(root!, initial);
    const saved = await store.load();
    expect(saved.c4?.revision).toBe(baseRevision + 1);
    expect(saved.c4Problems).toEqual([]);
    expect(saved.specs[0]?.body).toContain('```skaro-c4');
    const nextModel = structuredClone(saved.c4!);
    nextModel.revision = baseRevision + 2;
    const references = await Promise.all(
      ['c4.md', 'agent-output.md', 'completion-process.md', 'task-environments.md'].map(
        async (name) => ({
          path: `docs/${name}`,
          content: await readFile(new URL(`docs/${name}`, source), 'utf8'),
        }),
      ),
    );
    const next = await prepareC4Package(root!, {
      title: 'Документация C4',
      summary: 'Добавлены штатные документы процесса и проверки.',
      baseRevision: baseRevision + 1,
      model: nextModel,
      locale: 'ru',
      documents: references,
    });
    const before = await readFile(join(root!, '.skaro/architecture.md'), 'utf8');
    await store.writeDoc('architecture.md', before + '\n');
    await expect(applyC4Package(root!, next)).rejects.toThrow('changed after this proposal');
    expect(await readFile(join(root!, '.skaro/architecture.md'), 'utf8')).toBe(before + '\n');
    await store.writeDoc('architecture.md', before);
    await interruptWriter(root!, next);
    await access(join(root!, '.skaro/c4/transaction.json'));
    await recoverC4Transaction(root!);
    const recovered = await new ArtifactStore(root!).load();
    expect(recovered.c4?.revision).toBe(baseRevision + 2);
    expect(recovered.c4Problems).toEqual([]);
    for (const file of next.files)
      expect(await readFile(join(root!, '.skaro', file.path), 'utf8')).toBe(file.after);
    await applyC4Package(root!, next);
    const history = JSON.parse(
      await readFile(join(root!, `.skaro/c4/history/${baseRevision + 2}.json`), 'utf8'),
    );
    expect(history.hash).toBe(c4Hash(JSON.stringify(next)));
  },
  60_000,
);

async function interruptWriter(checkout: string, pkg: C4Package): Promise<void> {
  const module = new URL('./transaction.ts', import.meta.url).href;
  const proposal = join(checkout, 'output/c4-proposal.json');
  await mkdir(join(checkout, 'output'), { recursive: true });
  await writeFile(proposal, JSON.stringify(pkg));
  const script = `import {readFile} from 'node:fs/promises'; import {applyC4Package} from ${JSON.stringify(module)}; await applyC4Package(process.argv[1], JSON.parse(await readFile(process.argv[2], 'utf8')));`;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script, checkout, proposal],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  let interrupted = false;
  const watcher = watch(join(checkout, '.skaro/c4'), (_event, name) => {
    if (name?.toString() === 'transaction.json') {
      interrupted = true;
      child.kill('SIGKILL');
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () =>
        interrupted
          ? resolve()
          : reject(new Error(`Writer completed before interruption: ${output}`)),
      );
    });
  } finally {
    watcher.close();
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
