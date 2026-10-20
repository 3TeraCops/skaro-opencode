import {
  validateQuestionAnswer,
  type Interaction,
  type InteractionAnswer,
  type TimelineEvent,
  type TimelineState,
} from '@skaro/timeline';
import type { AppDb } from '@skaro/core';
import { withoutSecrets } from './session-log';
import { queueOwnerMessage } from './owner-commands';
import { openPrivate, sealPrivate } from './private-input';
import type { MessageInput } from '../shared/ipc';

type Question = Extract<Interaction, { kind: 'question' }>;
interface SavedAnswer {
  interaction: Question;
  answer: InteractionAnswer;
  encrypted?: string;
}
/** Decisions and all answers precede continuation. Several cards become one complete delivery. */
export class QuestionAnswers {
  private readonly db: AppDb;
  private readonly key: string;
  constructor(db: AppDb, owner: string) {
    this.db = db;
    this.key = `question.answers.${owner}`;
  }
  accept(
    question: Question,
    answer: InteractionAnswer,
    emit: (event: TimelineEvent) => void,
  ): void {
    validateQuestionAnswer(question, answer);
    const previous = this.pending({ items: [], turns: [], interactions: [], status: 'idle' });
    if (previous && this.db.commands.get(previous.commandId)?.state === 'delivered')
      this.delivered();
    const sanitized = withoutSecrets(question, answer);
    const encrypted = question.questions.some((q) => q.secret) ? sealPrivate(answer) : undefined;
    const saved = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    const entries = [
      ...saved.filter((entry) => entry.interaction.id !== question.id),
      { interaction: question, answer: sanitized, ...(encrypted ? { encrypted } : {}) },
    ];
    this.db.setSetting(this.key, entries);
    this.replay({ interaction: question, answer: sanitized }, emit);
  }
  private replay(entry: SavedAnswer, emit: (event: TimelineEvent) => void): void {
    const { interaction: question, answer } = entry;
    emit({
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${question.id}`,
        turnId: '',
        kind: 'decision',
        interaction: question,
        answer,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: question.id },
      },
    });
    emit({ t: 'interaction.closed', id: question.id, resolution: 'answered' });
  }
  /** Replay acceptance after a crash between the database commit and the journal write. */
  recover(state: TimelineState, emit: (event: TimelineEvent) => void): void {
    const entries = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    for (const entry of entries) {
      if (
        state.interactions.some((i) => i.id === entry.interaction.id) ||
        !state.items.some((i) => i.id === `skaro-decision-${entry.interaction.id}`)
      )
        this.replay(entry, emit);
    }
  }
  pending(state: TimelineState): (MessageInput & { commandId: string }) | undefined {
    if (state.interactions.some((i) => i.kind === 'question')) return undefined;
    const entries = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    if (!entries.length) return undefined;
    const textOf = (values: SavedAnswer[]) =>
      values
        .map((entry) =>
          entry.interaction.questions
            .map(
              (q) =>
                `${q.text}\n${entry.answer.kind === 'question' ? (entry.answer.answers[q.id]?.join('\n') ?? '') : ''}`,
            )
            .join('\n\n'),
        )
        .join('\n\n');
    const text = textOf(entries);
    const secrets: string[] = [];
    const decoded = entries.map((entry) => {
      if (!entry.encrypted) return entry;
      const answer = openPrivate<InteractionAnswer>(entry.encrypted);
      if (answer.kind === 'question')
        for (const question of entry.interaction.questions)
          if (question.secret) secrets.push(...(answer.answers[question.id] ?? []));
      return { ...entry, answer };
    });
    return {
      text,
      ...(secrets.length ? { privateText: sealPrivate({ text: textOf(decoded), secrets }) } : {}),
      commandId: `answers-${entries.map((entry) => entry.interaction.id).join('-')}`,
    };
  }
  delivered(): void {
    this.db.setSetting(this.key, null);
  }
  queue(
    method: 'chat.send' | 'task.send',
    project: string,
    owner: string,
    state: TimelineState,
  ): void {
    const input = this.pending(state);
    if (!input) return;
    const command = this.db.commands.get(input.commandId);
    if (command?.state === 'delivered') {
      this.delivered();
      return;
    }
    if (command) return;
    queueOwnerMessage(method, project, owner, input);
  }
}
