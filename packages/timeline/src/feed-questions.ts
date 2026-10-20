import { withoutSkaroNote } from './feed-input.ts';
import { asyncQuestionInput, isAsyncQuestion } from './async-question.ts';
import type { Item } from './model.ts';

/** A card answer resumes Codex through a user message; the decision row already shows it. */
export function questionHistory(items: Item[]): {
  items: Item[];
  cardAnswers: Map<string, string>;
} {
  const decisions = items.filter(
    (item) => item.kind === 'decision' && isAsyncQuestion(item.interaction),
  );
  const cardAnswers = new Map<string, string>();
  const byText = new Map<string, Item[]>();
  for (const item of items) {
    if (item.kind !== 'message' || item.role !== 'user' || item.parentId) continue;
    if (item.native.type === 'owner_command' && item.native.ref.startsWith('answers-'))
      cardAnswers.set(item.id, item.text);
    if (item.text.includes('command_id: answers-'))
      cardAnswers.set(item.id, withoutSkaroNote(item.text));
    const key = withoutSkaroNote(item.text);
    const list = byText.get(key) ?? [];
    list.push(item);
    byText.set(key, list);
  }
  for (const item of decisions) {
    if (item.kind !== 'decision' || !isAsyncQuestion(item.interaction)) continue;
    if (item.answer.kind !== 'question') continue;
    const input = asyncQuestionInput(item.interaction, item.answer).text;
    // Also recognize answers sent by the previous build, which prefixed the agent's question.
    const legacy = item.interaction.questions
      .map(
        (q) =>
          `${q.text}\n${(item.answer.kind === 'question' ? item.answer.answers[q.id] : [])?.join('\n')}`,
      )
      .join('\n\n');
    const replies = [
      ...(byText.get(input) ?? []),
      ...(legacy === input ? [] : (byText.get(legacy) ?? [])),
    ].filter(
      (candidate) =>
        candidate.kind === 'message' &&
        candidate.role === 'user' &&
        !candidate.parentId &&
        !cardAnswers.has(candidate.id) &&
        Math.abs(candidate.startedAt - item.startedAt) < 10_000 &&
        (withoutSkaroNote(candidate.text) === input || withoutSkaroNote(candidate.text) === legacy),
    );
    const reply = replies.sort(
      (a, b) => Math.abs(a.startedAt - item.startedAt) - Math.abs(b.startedAt - item.startedAt),
    )[0];
    if (reply) cardAnswers.set(reply.id, input ?? '');
  }
  const nativeCommands = new Map<string, number>();
  const nativeTexts = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'message' || item.role !== 'user' || item.native.type === 'owner_command')
      continue;
    for (const match of item.text.matchAll(/command_id: ([^\r\n]+)/g)) {
      const command = match[1]!;
      nativeCommands.set(command, Math.max(nativeCommands.get(command) ?? 0, item.startedAt));
    }
    const text = withoutSkaroNote(item.text);
    nativeTexts.set(text, Math.max(nativeTexts.get(text) ?? 0, item.startedAt));
  }
  const history = items
    .filter(
      (item) =>
        item.native.type !== 'owner_command' ||
        item.kind !== 'message' ||
        Math.max(
          nativeCommands.get(item.native.ref) ?? -Infinity,
          nativeTexts.get(item.text) ?? -Infinity,
        ) <
          item.startedAt - 2000,
    )
    .map((item) => {
      // Old logs recorded the answer against a completed turn, moving its end banner forward.
      return item.kind === 'decision' && isAsyncQuestion(item.interaction)
        ? { ...item, turnId: '' }
        : item;
    });
  return { items: history, cardAnswers };
}
