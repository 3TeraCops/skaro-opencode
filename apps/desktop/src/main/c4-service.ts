import { c4Context } from './c4-context';
import { randomUUID } from 'node:crypto';
import {
  applyC4Package,
  c4PackageStatus,
  prepareC4Package,
  c4PackageText,
  git,
  type C4Package,
  type AppDb,
} from '@skaro/core';
import type {
  C4Handlers,
  ProposeC4Args,
  ReviewC4Args,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import type { Projects } from './projects';
import {
  c4ArchitectureHash,
  c4ChangeHash,
  c4CoverageProblems,
  c4ReviewKey,
  type C4TaskReview,
} from './c4-review';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
export interface C4ProposalRecord {
  scope: SkaroScope;
  package: C4Package;
  item: ProposalItem;
}
interface Deps {
  db: AppDb;
  projects: Projects;
  locale(): string;
  publish(scope: SkaroScope, item: ProposalItem): Promise<void>;
  changed(projectId: string): void;
  stageImport(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult>;
}

export class C4Service implements C4Handlers {
  private readonly deps: Deps;
  private readonly deciding = new Map<string, Promise<void>>();
  constructor(deps: Deps) {
    this.deps = deps;
  }
  private key(projectId: string) {
    return `c4.proposals.${projectId}`;
  }
  records(projectId: string): C4ProposalRecord[] {
    return this.deps.db.getSetting(this.key(projectId), []);
  }
  private save(record: C4ProposalRecord): void {
    const records = this.records(record.scope.projectId).filter(
      (r) => r.item.id !== record.item.id,
    );
    this.deps.db.setSetting(this.key(record.scope.projectId), [...records, record]);
  }
  private caller(scope: SkaroScope): string {
    const context = this.deps.projects.get(scope.projectId);
    if (scope.kind === 'task') {
      const run = scope.runId ? this.deps.db.getRun(scope.runId) : undefined;
      if (
        !run ||
        run.projectId !== scope.projectId ||
        run.taskId !== scope.taskId ||
        run.retiredAt !== undefined ||
        this.deps.db.listRuns(scope.projectId, scope.taskId!)[0]?.id !== run.id
      )
        throw new Error('This task run is no longer current.');
      return run.worktree ?? context.root;
    }
    const chat = scope.chatId ? this.deps.db.getChat(scope.chatId) : undefined;
    if (scope.kind !== 'project_chat' || !chat || chat.projectId !== scope.projectId)
      throw new Error('Invalid C4 chat scope');
    return context.root;
  }
  async context(scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    return c4Context(
      this.deps.projects.get(scope.projectId),
      this.deps.db,
      this.records(scope.projectId),
      scope,
      checkout,
    );
  }
  async propose(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    if (scope.importId) return this.deps.stageImport(args, scope);
    const context = this.deps.projects.get(scope.projectId);
    const pkg = await prepareC4Package(context.root, {
      ...args,
      locale: this.deps.locale(),
      codeRoot: checkout,
      ...(scope.kind === 'task' ? { task: { id: scope.taskId!, runId: scope.runId! } } : {}),
    });
    const item: ProposalItem = {
      id: `skaro-c4-${randomUUID()}`,
      turnId: '',
      kind: 'proposal',
      state: 'pending',
      status: 'done',
      startedAt: Date.now(),
      native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
      proposal: {
        type: 'architecture',
        packageId: pkg.id,
        title: pkg.title,
        summary: pkg.summary,
        baseRevision: pkg.baseRevision,
        files: pkg.files,
        ...(pkg.task ? { task: pkg.task } : {}),
        before: c4PackageText(pkg, 'before'),
        after: c4PackageText(pkg, 'after'),
      },
    };
    this.save({ scope, package: pkg, item });
    await this.deps.publish(scope, item);
    return {
      text: `Saved C4 package ${item.id} for ONE owner decision. Nothing has been applied. Do not propose its documents separately or report them accepted. Read get_c4_context after the owner decides.`,
    };
  }
  decide(projectId: string, id: string, action: 'apply' | 'reject'): Promise<void> {
    const previous = this.deciding.get(projectId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.decideOnce(projectId, id, action));
    this.deciding.set(projectId, operation);
    return operation.finally(() => {
      if (this.deciding.get(projectId) === operation) this.deciding.delete(projectId);
    });
  }
  private async decideOnce(
    projectId: string,
    id: string,
    action: 'apply' | 'reject',
  ): Promise<void> {
    const record = this.records(projectId).find((r) => r.item.id === id);
    if (!record) throw new Error('Unknown C4 package');
    if (record.item.state === 'applied' && action === 'apply') return;
    if (record.item.state !== 'pending' && record.item.state !== 'accepted')
      throw new Error('This C4 package is already decided');
    if (action === 'reject' && record.item.state === 'accepted')
      throw new Error(
        'A confirmed package must finish recovery; it cannot be rejected after writing starts.',
      );
    const context = this.deps.projects.get(projectId);
    if (action === 'reject') record.item = { ...record.item, state: 'rejected' };
    else {
      record.item = { ...record.item, state: 'accepted', result: {} };
      this.save(record);
      await this.deps.publish(record.scope, record.item);
      try {
        await applyC4Package(context.root, record.package);
        record.item = { ...record.item, state: 'applied', result: {} };
      } catch (error) {
        const status = await c4PackageStatus(context.root, record.package);
        record.item = {
          ...record.item,
          state: status === 'applied' ? 'applied' : status === 'writing' ? 'accepted' : 'pending',
          result: { error: String(error) },
        };
        this.save(record);
        context.invalidate();
        await this.deps.publish(record.scope, record.item);
        throw error;
      }
    }
    this.save(record);
    context.invalidate();
    this.deps.changed(projectId);
    await this.deps.publish(record.scope, record.item);
  }
  async review(args: ReviewC4Args, scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    if (scope.kind !== 'task' || !scope.taskId || !scope.runId)
      throw new Error('C4 code review requires a current task run');
    const context = this.deps.projects.get(scope.projectId);
    this.deps.db.setSetting(c4ReviewKey(scope.projectId, scope.taskId), null);
    context.invalidate();
    const artifacts = await context.load();
    const baseHead = (
      await git(checkout, ['rev-parse', artifacts.config.baseBranch])
    ).stdout.trim();
    const problems = c4CoverageProblems(artifacts, scope.taskId, args);
    if (args.changeHash !== (await c4ChangeHash(checkout, baseHead)))
      problems.push('Code changed since context was read.');
    if (
      this.records(scope.projectId).some(
        (r) =>
          r.package.task?.id === scope.taskId && ['pending', 'accepted'].includes(r.item.state),
      )
    )
      problems.push('A required task architecture package is still pending.');
    if (problems.length) return { text: problems.join('\n'), isError: true };
    const review: C4TaskReview = {
      ...args,
      baseHead,
      modelHash: c4ArchitectureHash(artifacts),
      runId: scope.runId,
    };
    this.deps.db.setSetting(c4ReviewKey(scope.projectId, scope.taskId), review);
    return {
      text: 'C4 code review saved for this exact model revision and code change fingerprint. submit_result rechecks both.',
    };
  }
  async restore(scope: SkaroScope): Promise<void> {
    for (const record of this.records(scope.projectId).filter((r) =>
      scope.taskId ? r.scope.taskId === scope.taskId : r.scope.chatId === scope.chatId,
    )) {
      if (record.item.state === 'accepted') {
        try {
          await this.decide(scope.projectId, record.item.id, 'apply');
        } catch {
          /* Durable error is displayed on the existing card. */
        }
      } else await this.deps.publish(record.scope, record.item);
    }
  }
}
