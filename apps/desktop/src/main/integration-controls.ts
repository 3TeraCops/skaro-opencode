import {
  Timeline,
  isAsyncQuestion,
  asyncQuestionInput,
  type InteractionAnswer,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import type { ResolverSession } from './integration-worker';
import {
  currentIntegration,
  integrationQueueKey,
  participatesIn,
  type IntegrationOperation,
} from './integration-model';

const CONTROLLED: IntegrationOperation['state'][] = [
  'preparing',
  'resolving',
  'verifying',
  'paused',
  'waiting',
  'failed',
];

/** User input addresses the current candidate writer; a stopped writer never resumes implicitly. */
export class IntegrationControls {
  private readonly ctx: TaskRunEngine;
  private readonly sessions: Map<string, ResolverSession>;
  constructor(ctx: TaskRunEngine, sessions: Map<string, ResolverSession>) {
    this.ctx = ctx;
    this.sessions = sessions;
  }

  /** The chat of every task of a merge controls it, not only the chat of its first task. */
  private current(projectId: string, taskId: string): IntegrationOperation | undefined {
    return currentIntegration(this.ctx.integrations.store.all(projectId), taskId, CONTROLLED);
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<boolean> {
    const op = this.current(projectId, taskId);
    if (!op) return false;
    await this.deliver(op, input);
    return true;
  }

  private async deliver(op: IntegrationOperation, input: MessageInput): Promise<void> {
    const live = this.sessions.get(op.id);
    if (live) await live.session.steer(input);
    else {
      this.ctx.integrations.store.appendInput(op.id, input);
      if (op.executor) return;
      op.state = 'resolving';
      op.attempts = 0;
      this.ctx.integrations.service.save(op);
      this.ctx.integrations.enqueue(op);
    }
  }

  async respond(
    projectId: string,
    taskId: string,
    id: string,
    answer: InteractionAnswer,
  ): Promise<boolean> {
    const op = this.ctx.integrations.store
      .all(projectId)
      .find((value) => participatesIn(value, taskId) && id.startsWith(`integration-${value.id}:`));
    if (!op) return false;
    const scoped = id.slice(`integration-${op.id}:`.length);
    const timeline = Timeline.from(await this.ctx.integrations.history.events(op));
    const interaction = timeline.state.interactions.find((value) => value.id === scoped);
    if (!interaction) throw new Error('This integration interaction is no longer open.');
    const live = this.sessions.get(op.id);
    if (isAsyncQuestion(interaction)) {
      // The answer continues the candidate that asked; a finished one only closes its card.
      if (CONTROLLED.includes(op.state))
        await this.deliver(op, asyncQuestionInput(interaction, answer));
    } else {
      if (!live)
        throw new Error('The old approval expired; the current agent will request it again.');
      await live.session.respond(scoped.replace(`${live.worker}:`, ''), answer);
    }
    // Reload to avoid replacing a newly saved continuation with a historical snapshot.
    const current = live?.operation ?? this.ctx.integrations.store.find(projectId, op.id)!;
    await this.ctx.integrations.history.event(current, {
      t: 'interaction.closed',
      id: scoped,
      resolution: 'answered',
    });
    this.ctx.integrations.setRuntime(current, live ? 'running' : 'queued');
    return true;
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    const saved = this.current(projectId, taskId);
    if (!saved) return;
    const live = this.sessions.get(saved.id);
    const op = this.ctx.integrations.executing(saved.id) ?? live?.operation ?? saved;
    this.ctx.integrations.pause(op);
    this.ctx.queue.cancel(integrationQueueKey(op));
    await this.ctx.processes.stop(`verification-${op.id}`);
    this.ctx.integrations.service.interrupt(op.id);
    await live?.session.interrupt();
    this.ctx.integrations.setRuntime(op, 'idle');
  }
}
