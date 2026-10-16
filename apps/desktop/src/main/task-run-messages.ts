import { isAsyncQuestion, asyncQuestionInput, type InteractionAnswer } from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { key } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import { trackRun } from './task-run-access';
import type { TaskRunEngine } from './task-run-engine';

/** messages: a focused part of the task-run controller. */
export class TaskRunMessages {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    if (await this.ctx.integrations.controls.send(projectId, taskId, input)) return;
    let active = await this.ctx.history.restore(projectId, taskId);
    if (!active) return this.ctx.scheduling.start(projectId, taskId, input);
    active = await this.ctx.handoff.recover(active);
    await this.turn(active, input);
  }

  /** Joins the running turn, or starts a new one when a slot is free (it waits in the queue). */
  async turn(active: ActiveRun, input: MessageInput): Promise<void> {
    if (active.switching) throw new Error('The agent is being changed. Retry after the handoff.');
    const { projectId, taskId } = active;
    const working = active.timeline.state.status !== 'idle';
    if (working || this.ctx.scheduling.holdsSlot(projectId, taskId)) {
      await this.deliver(active, input);
    } else {
      await this.ctx.scheduling.enqueue(projectId, taskId, input);
    }
  }

  /** Straight to the agent: only for a turn that holds its slot. */
  async deliver(active: ActiveRun, input: MessageInput): Promise<void> {
    const session = await this.ctx.sessions.attach(active);
    if (active.timeline.state.status === 'idle') await session.send(input);
    else await session.steer(input);
  }

  async respond(
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    if (await this.ctx.integrations.controls.respond(projectId, taskId, interactionId, answer))
      return;
    const active = await this.ctx.history.restore(projectId, taskId);
    if (!active) throw new Error('The agent session has ended');
    return trackRun(active, () => this.answer(active, interactionId, answer));
  }

  private async answer(
    active: ActiveRun,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const interaction = active.timeline.state.interactions.find((i) => i.id === interactionId);
    if (isAsyncQuestion(interaction)) {
      await this.turn(active, asyncQuestionInput(interaction, answer));
      this.ctx.history.skaroEvent(active, {
        t: 'interaction.closed',
        id: interactionId,
        resolution: 'answered',
      });
    } else {
      if (!active.session) throw new Error('The agent session has ended');
      const nativeId = active.run.previousRunId
        ? interactionId.replace(`${active.run.id}:`, '')
        : interactionId;
      await active.session.respond(nativeId, answer);
    }
    if (!interaction) return;
    // The decision stays in the feed (and the log) after the card closes.
    this.ctx.history.skaroEvent(active, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interactionId}`,
        turnId: isAsyncQuestion(interaction) ? '' : (active.timeline.state.turns.at(-1)?.id ?? ''),
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interactionId },
      },
    });
  }

  async interrupt(projectId: string, taskId: string): Promise<void> {
    await this.ctx.integrations.controls.interrupt(projectId, taskId);
    const k = key(projectId, taskId);
    if (this.ctx.handoff.changing(this.ctx.active.get(k)))
      throw new Error('Wait for the agent handoff to finish before stopping the task.');
    if (this.ctx.queue.cancel(k)) {
      this.ctx.queuedInputs.delete(k);
      // A started task goes back to what its feed says; a new one was never running.
      const active = this.ctx.active.get(k);
      if (active) this.ctx.events.settleRuntime(active);
      else this.ctx.setRuntime(projectId, taskId, 'idle');
      return;
    }
    await this.ctx.active.get(k)?.session?.interrupt();
  }

  async stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    await this.ctx.requireActive(projectId, taskId).session?.stopBackground(backgroundId);
  }
}
