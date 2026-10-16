import type { TaskRunEngine } from './task-run-engine';
import type { IntegrationOperation } from './integration-model';
import { IntegrationPending, integrationEnvironmentKey } from './integration-model';
import { admitIntegration } from './integration-git';
import { assertResultUnchanged } from './completion-results';
import { integrationChecks } from './integration-checks';
import { runIntegrationWorker } from './integration-worker';
import { errorText } from './session-log';
import { IntegrationAgentUnavailable, integrationFailure } from './integration-failure';

/** Execute one queue lease; continuation is emitted only after the candidate is verified. */
export async function executeIntegration(
  ctx: TaskRunEngine,
  op: IntegrationOperation,
): Promise<void> {
  const integration = ctx.integrations;
  try {
    integration.setRuntime(op, 'running');
    await integration.history.announce(
      op,
      op.conflicts.length
        ? `Skaro разрешает конфликт интеграции для ${op.taskId}: ${op.conflicts.join(', ')}`
        : `Skaro проверяет интеграцию для ${op.taskId}.`,
    );
    if (op.worker) await ctx.processes.stop(op.worker);
    await ctx.processes.stop(`verification-${op.id}`);
    op.worker = undefined;
    integration.assertExecuting(op);
    await admitIntegration(ctx.project(op.projectId), op, (value) =>
      integration.service.save(value),
    );
    for (const result of op.results) await assertResultUnchanged(ctx.project(op.projectId), result);
    integration.assertExecuting(op);
    if (op.state === 'preparing') await integration.service.advance(op);
    integration.assertExecuting(op);
    if (op.state === 'verifying' && !op.needsVerification && integrationChecks(op).length) {
      const key = integrationEnvironmentKey(op);
      ctx.environments.bindIntegration(key, op.worktree);
      const environment = await ctx.environments.describe(key);
      ctx.deps.db.setSetting(`integration.${op.id}.env`, environment.variables);
      integration.assertExecuting(op);
      try {
        await integration.service.serial(op.id, () =>
          integration.service.verify(op, [], environment.variables),
        );
      } catch (error) {
        integration.assertExecuting(op);
        op.error = errorText(error);
        op.needsVerification = true;
        op.state = 'resolving';
        integration.service.save(op);
        await integration.history.notice(op, op.error, true);
      }
    }
    integration.assertExecuting(op);
    if (integration.store.inputs(op.id).length) {
      // A message arriving while checks run must reach the resolver before publication.
      op.state = 'resolving';
      op.needsVerification = true;
      integration.service.save(op);
    }
    if (op.state !== 'ready' && op.attempts >= 3)
      throw new Error(
        `Integration exhausted its recovery attempts; candidate is retained.\n${integrationFailure(op)}`,
      );
    if (op.state !== 'ready')
      await runIntegrationWorker(ctx, op, integration.history, (value) =>
        integration.session(op.id, value),
      );
    if (op.state === 'paused' || op.state === 'waiting') {
      integration.setRuntime(op, op.state === 'waiting' ? 'waiting' : 'idle');
      return;
    }
    integration.assertExecuting(op);
    await integration.service.assertReady(op);
    integration.assertExecuting(op);
    op.executor = undefined;
    integration.service.save(op);
    await integration.history.notice(op, 'Интеграция проверена. Skaro продолжает выполнение.');
    integration.setRuntime(op, 'idle');
    await ctx.environments
      .stop(integrationEnvironmentKey(op))
      .catch((error) => integration.history.notice(op, errorText(error), true));
    if (integration.closing) return;
    if (op.purpose === 'dependencies') ctx.queue.enqueue([`${op.projectId}\n${op.taskId}`]);
    else if (op.publish) await ctx.merges.coordinator.publishCandidate(op);
    else {
      const active = await ctx.history.restore(op.projectId, op.taskId);
      if (active) await ctx.merges.showCard(active, ctx.project(op.projectId));
    }
  } catch (error) {
    if (op.state === 'paused' || integration.wasInterrupted(op.id)) return;
    if (error instanceof IntegrationPending) {
      op.state = 'stale';
      integration.service.save(op);
      return;
    }
    if (integration.closing) {
      // A verified candidate remains ready for continuation after restart.
      if (op.state !== 'ready') op.state = op.needsVerification ? 'resolving' : 'preparing';
      integration.service.save(op);
      return;
    }
    op.error = errorText(error);
    op.state = 'failed';
    integration.service.save(op);
    // The agent's own notice and the end of its turn already show a limit or sign-in failure.
    if (!(error instanceof IntegrationAgentUnavailable))
      await integration.history.notice(op, op.error, true);
    integration.setRuntime(op, 'failed');
    ctx.startup.fail(op.projectId, op.taskId, op.error);
    // Only a crashed agent is retried unattended; a finished turn waits for the owner instead.
    if (!(error instanceof IntegrationAgentUnavailable) && op.attempts > 0 && op.attempts < 3) {
      op.state = 'resolving';
      integration.service.save(op);
      setImmediate(() => integration.enqueue(op));
    }
  }
}
