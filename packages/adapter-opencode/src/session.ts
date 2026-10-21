// OpenCode session: one private server per Skaro session; canonical events are projected
// from the v2 event stream (`/api/event`). The raw stream is recorded before projection (P2).

import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EventChannel,
  arr,
  num,
  obj,
  str,
  type AgentError,
  type AgentSession,
  type Interaction,
  type InteractionAnswer,
  type Item,
  type NoticeCode,
  type PermissionMode,
  type Question,
  type SessionOptions,
  type TimelineEvent,
  type UserInput,
} from '@skaro/timeline';
import { resolveOpenCodeBinary } from './bin.ts';
import { OpenCodeClient, startServer, type OpenCodeServer } from './server.ts';

interface NativeEvent {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
}

type PendingInteraction =
  | { kind: 'permission'; requestId: string }
  | {
      kind: 'question';
      formId: string;
      questions: Question[];
      /** Question id → label → value expected by the `question` tool. */
      values: Map<string, Map<string, string>>;
    }
  | { kind: 'form'; formId: string; fields: Record<string, string> };

export class OpenCodeSession implements AgentSession {
  readonly events = new EventChannel<TimelineEvent>();
  private readonly options: SessionOptions;
  private server: OpenCodeServer | undefined;
  private client: OpenCodeClient | undefined;
  private sessionId = '';
  private model = '';
  private effort: string | undefined;
  private mode: PermissionMode;
  private instructionsSent = false;
  private closed = false;
  private abort: AbortController | undefined;
  private turns = 0;
  private activeTurn: string | undefined;
  private readonly items = new Map<string, Item>();
  private readonly toolNames = new Map<string, string>();
  private readonly toolInputs = new Map<string, string>();
  private readonly interactions = new Map<string, PendingInteraction>();
  private readonly messageOf = new Map<string, string>();

  private readonly binaryOverride: string | undefined;

  constructor(options: SessionOptions, binaryOverride?: string) {
    this.options = options;
    this.binaryOverride = binaryOverride;
    this.mode = options.permissionMode;
    this.effort = options.effort;
  }

  async start(): Promise<void> {
    const config: Record<string, unknown> = {};
    if (this.options.mcpServers && Object.keys(this.options.mcpServers).length > 0) {
      const servers: Record<string, unknown> = {};
      for (const [name, server] of Object.entries(this.options.mcpServers)) {
        servers[name] =
          server.type === 'http'
            ? {
                type: 'remote',
                url: server.url,
                ...(server.headers ? { headers: server.headers } : {}),
              }
            : {
                type: 'local',
                command: [server.command, ...server.args],
                ...(server.env ? { environment: server.env } : {}),
              };
      }
      config['mcp'] = { servers };
    }
    const binary =
      this.options.env?.['OPENCODE_BIN'] ?? this.binaryOverride ?? (await resolveOpenCodeBinary());
    if (!binary) throw new Error('OpenCode is not installed');
    this.server = await startServer({
      binary,
      cwd: this.options.cwd,
      ...(this.options.env ? { env: this.options.env } : {}),
      ...(Object.keys(config).length ? { config } : {}),
    });
    this.client = new OpenCodeClient(this.server);

    const resume = this.options.resume;
    if (resume) {
      this.sessionId = resume;
      try {
        await this.client.request('GET', `/api/session/${encodeURIComponent(resume)}`);
      } catch {
        this.sessionId = '';
      }
    }
    if (!this.sessionId) {
      const created = await this.client.request<Record<string, unknown>>('POST', '/api/session', {
        title: `Skaro ${new Date().toISOString()}`,
        location: { directory: this.options.cwd },
        ...(this.options.model ? { model: parseModel(this.options.model, this.effort) } : {}),
      });
      const data = obj(created?.['data']) ?? {};
      this.sessionId = str(data['id']) ?? '';
      const model = obj(data['model']);
      this.model = model
        ? `${str(model['providerID']) ?? ''}/${str(model['id']) ?? ''}`
        : (this.options.model ?? '');
    } else {
      this.model = this.options.model ?? '';
    }

    // Plan-first has no approval checkpoint in OpenCode: the plan agent would stop without a card.
    // Read-only sessions still use it, because they never edit.
    if (this.options.readOnly) {
      await this.client
        .request('POST', `/api/session/${encodeURIComponent(this.sessionId)}/agent`, {
          agent: 'plan',
        })
        .catch(() => undefined);
    }

    this.abort = new AbortController();
    void this.listen(this.abort.signal);

    // Forms created before a restart stay pending in the native session; surface them again.
    void this.loadPendingForms();

    if (this.options.instructions && !this.instructionsSent) {
      this.instructionsSent = true;
      await this.client
        .request(
          'PUT',
          `/api/experimental/session/${encodeURIComponent(this.sessionId)}/instructions/entries/skaro`,
          { value: this.options.instructions },
        )
        .catch(() => undefined);
    }

    this.events.push({
      t: 'session.started',
      nativeSessionId: this.sessionId,
      model: this.model,
      capabilities: {
        agentVersion: '2',
        flags: ['http-api', 'permissions', 'revert', 'compaction'],
      },
    });
  }

  private async listen(signal: AbortSignal): Promise<void> {
    try {
      for await (const raw of this.client!.stream(signal)) {
        this.raw(raw);
        this.project(raw as NativeEvent);
      }
    } catch (error) {
      if (!signal.aborted && !this.closed) this.failTurn(String(error));
    } finally {
      if (!this.closed) this.finishTurn('failed', 'OpenCode connection closed');
    }
  }

  private raw(event: NativeEvent): void {
    this.options.raw({ ts: Date.now(), dir: 'out', line: event });
  }

  send(input: UserInput): Promise<void> {
    return this.prompt(input, 'queue');
  }

  steer(input: UserInput): Promise<void> {
    return this.prompt(input, 'steer');
  }

  private async prompt(input: UserInput, delivery: 'steer' | 'queue'): Promise<void> {
    if (this.closed) throw new Error('OpenCode session is closed');
    if (!this.client || !this.sessionId) await this.start();
    const turn = this.startTurn();
    this.userItem(turn, input.text);
    const payload: Record<string, unknown> = { text: input.text, delivery };
    if (input.images?.length)
      payload['files'] = input.images.map((path) => ({
        uri: pathToFileURL(path).href,
        name: basename(path),
      }));
    const request = { ...payload };
    this.options.raw({ ts: Date.now(), dir: 'in', line: { prompt: request } });
    try {
      await this.client!.request(
        'POST',
        `/api/session/${encodeURIComponent(this.sessionId)}/prompt`,
        payload,
      );
    } catch (error) {
      this.finishTurn('failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async respond(interactionId: string, answer: InteractionAnswer): Promise<void> {
    const pending = this.interactions.get(interactionId);
    if (!pending) throw new Error(`no open interaction ${interactionId}`);
    if (pending.kind === 'permission') {
      const decision =
        answer.kind === 'approval'
          ? answer.choice === 'allow_once'
            ? 'once'
            : answer.choice === 'allow_session'
              ? 'always'
              : 'reject'
          : 'reject';
      const message =
        answer.kind === 'approval' && 'message' in answer ? answer.message : undefined;
      await this.reply(pending.requestId, decision, message);
    } else if (pending.kind === 'question') {
      if (answer.kind !== 'question') throw new Error('A question answer is required');
      const values: Record<string, string | string[]> = {};
      for (const question of pending.questions) {
        const mapping = pending.values.get(question.id);
        const selected = (answer.answers[question.id] ?? [])
          .map((label) => mapping?.get(label) ?? label)
          .filter((value) => value.trim());
        if (!selected.length) throw new Error('Answer every question');
        values[question.id] = question.multi ? selected : selected[0]!;
      }
      await this.replyForm(pending.formId, values);
    } else {
      if (answer.kind !== 'form') throw new Error('A form answer is required');
      if (answer.action === 'decline') {
        await this.cancelForm(pending.formId);
      } else {
        const values: Record<string, string | number | boolean> = {};
        for (const [id, type] of Object.entries(pending.fields)) {
          const value = answer.values?.[id];
          if (value === undefined) continue;
          values[id] = type === 'number' && typeof value === 'string' ? Number(value) : value;
        }
        await this.replyForm(pending.formId, values);
      }
    }
    this.interactions.delete(interactionId);
    this.events.push({ t: 'interaction.closed', id: interactionId, resolution: 'answered' });
    this.status('working');
  }

  private reply(requestId: string, decision: string, message?: string): Promise<void> {
    return this.client!.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      { decision, ...(message ? { message } : {}) },
    ) as Promise<void>;
  }

  private replyForm(formId: string, answer: Record<string, unknown>): Promise<void> {
    return this.client!.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/form/${encodeURIComponent(formId)}/reply`,
      { answer },
    ) as Promise<void>;
  }

  private cancelForm(formId: string): Promise<void> {
    return this.client!.request(
      'DELETE',
      `/api/session/${encodeURIComponent(this.sessionId)}/form/${encodeURIComponent(formId)}`,
    ) as Promise<void>;
  }

  private async loadPendingForms(): Promise<void> {
    if (!this.client || !this.sessionId) return;
    try {
      const response = await this.client.request<Record<string, unknown>>(
        'GET',
        `/api/session/${encodeURIComponent(this.sessionId)}/form`,
      );
      for (const form of arr(response?.['data'])) this.formCreated({ data: { form } });
    } catch {
      // A server without forms support has nothing to restore.
    }
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.model = model;
    this.effort = effort;
    await this.client?.request('POST', `/api/session/${encodeURIComponent(this.sessionId)}/model`, {
      model: parseModel(model, effort),
    });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
  }

  async rewind(toItemId: string): Promise<void> {
    const messageID = this.messageOf.get(toItemId);
    if (!messageID || !this.client) throw new Error(`unknown message ${toItemId}`);
    await this.client.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/revert/stage`,
      { messageID, files: true },
    );
    await this.client.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/revert/commit`,
    );
    this.events.push({ t: 'rewound', toItemId });
  }

  async compact(): Promise<void> {
    await this.client?.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/compact`,
      {},
    );
  }

  async interrupt(): Promise<void> {
    await this.client?.request(
      'POST',
      `/api/session/${encodeURIComponent(this.sessionId)}/interrupt`,
    );
  }

  async stopBackground(_taskId: string): Promise<void> {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    this.server?.close();
    this.events.close();
  }

  // ---- projection -------------------------------------------------------------------

  private project(event: NativeEvent): void {
    const data = event.data ?? {};
    if (str(data['sessionID']) && data['sessionID'] !== this.sessionId) return;
    const type = str(event.type) ?? '';
    switch (type) {
      case 'session.execution.started':
        this.ensureTurn();
        this.status('working');
        break;
      case 'session.execution.succeeded':
        this.finishTurn('done');
        break;
      case 'session.execution.interrupted':
        this.finishTurn('interrupted');
        break;
      case 'session.execution.failed':
        this.finishTurn('failed', str(obj(data['error'])?.['message']), errorOf(data['error']));
        break;
      case 'session.status': {
        const status = obj(data['status']) ?? {};
        if (status['type'] === 'idle') this.status('idle');
        else if (status['type'] === 'retry') {
          this.status('working');
          this.notice('rate_limit', str(status['message']) ?? 'retrying', {
            retry: {
              attempt: num(status['attempt']) ?? 1,
              max: 5,
              inMs: Math.max(0, (num(status['next']) ?? Date.now()) - Date.now()),
            },
          });
        } else this.status('working');
        break;
      }
      case 'session.text.started':
        this.textItem(event, 'message', 'agent');
        break;
      case 'session.text.delta':
        this.append(event, 'text', str(data['delta']) ?? '');
        break;
      case 'session.text.ended':
        this.textEnded(event, 'message');
        break;
      case 'session.reasoning.started':
        this.textItem(event, 'reasoning', 'agent');
        break;
      case 'session.reasoning.delta':
        this.append(event, 'text', str(data['delta']) ?? '');
        break;
      case 'session.reasoning.ended':
        this.textEnded(event, 'reasoning');
        break;
      case 'session.tool.input.started':
        this.toolStarted(event);
        break;
      case 'session.tool.input.ended':
        this.toolInputs.set(str(data['id']) ?? '', str(data['text']) ?? '');
        break;
      case 'session.tool.called':
        this.toolCalled(event);
        break;
      case 'session.tool.success':
        this.toolFinished(event, false);
        break;
      case 'session.tool.failed':
        this.toolFinished(event, true);
        break;
      case 'permission.asked':
        this.permissionAsked(event);
        break;
      case 'form.created':
        this.formCreated(event);
        break;
      case 'form.replied':
        this.formClosed(str(data['id']), 'answered');
        break;
      case 'form.cancelled':
        this.formClosed(str(data['id']), 'cancelled');
        break;
      case 'session.retry.scheduled':
        this.notice('rate_limit', str(obj(data['error'])?.['message']) ?? 'retrying', {
          retry: { attempt: num(data['attempt']) ?? 1, max: 5, inMs: 1000 },
        });
        break;
      case 'session.compaction.started':
        this.notice('compaction', 'Compacting the conversation');
        break;
      case 'session.usage.updated':
        this.usage(data);
        break;
      case 'session.idle':
        if (this.activeTurn) this.finishTurn('done');
        else this.status('idle');
        break;
      default:
        break;
    }
  }

  private ensureTurn(): string {
    if (this.activeTurn) return this.activeTurn;
    return this.startTurn();
  }

  private startTurn(): string {
    const turnId = `turn-${++this.turns}`;
    this.activeTurn = turnId;
    this.events.push({ t: 'turn.started', turnId });
    return turnId;
  }

  private finishTurn(
    outcome: 'done' | 'interrupted' | 'failed',
    message?: string,
    error?: AgentError,
  ): void {
    const turnId = this.activeTurn;
    this.activeTurn = undefined;
    if (turnId) {
      this.events.push({
        t: 'turn.completed',
        turnId,
        outcome,
        ...(error ? { error } : message ? { error: { category: 'other', message } } : {}),
      });
    }
    this.status('idle');
  }

  private failTurn(message: string): void {
    if (this.activeTurn) this.finishTurn('failed', message);
  }

  private status(state: 'working' | 'waiting' | 'idle'): void {
    this.events.push({ t: 'status', state });
  }

  private notice(code: NoticeCode, text: string, extra: Record<string, unknown> = {}): void {
    const turnId = this.ensureTurn();
    const id = `${turnId}:notice:${Date.now()}`;
    this.events.push({
      t: 'item.upsert',
      item: {
        id,
        turnId,
        status: 'done',
        startedAt: Date.now(),
        endedAt: Date.now(),
        native: { agent: 'opencode', type: code, ref: id },
        kind: 'notice',
        level: code === 'compaction' ? 'info' : 'warning',
        code,
        text,
        ...extra,
      } as Item,
    });
  }

  private userItem(turnId: string, text: string): void {
    const id = `${turnId}:user`;
    this.events.push({
      t: 'item.upsert',
      item: {
        id,
        turnId,
        status: 'done',
        startedAt: Date.now(),
        endedAt: Date.now(),
        native: { agent: 'opencode', type: 'user', ref: id },
        kind: 'message',
        role: 'user',
        text,
      },
    });
  }

  private itemId(event: NativeEvent, ordinal: unknown): string {
    return `${str(event.data?.['assistantMessageID']) ?? 'msg'}:${String(ordinal ?? 0)}`;
  }

  private textItem(event: NativeEvent, kind: 'message' | 'reasoning', role: 'agent'): void {
    const id = this.itemId(event, event.data?.['ordinal']);
    const turnId = this.ensureTurn();
    this.messageOf.set(id, str(event.data?.['assistantMessageID']) ?? '');
    const item: Item =
      kind === 'message'
        ? {
            id,
            turnId,
            status: 'running',
            startedAt: Date.now(),
            native: { agent: 'opencode', type: 'text', ref: id },
            kind: 'message',
            role,
            text: '',
          }
        : {
            id,
            turnId,
            status: 'running',
            startedAt: Date.now(),
            native: { agent: 'opencode', type: 'reasoning', ref: id },
            kind: 'reasoning',
            text: '',
          };
    this.items.set(id, item);
    this.events.push({ t: 'item.upsert', item });
  }

  private append(event: NativeEvent, field: 'text', chunk: string): void {
    if (!chunk) return;
    const id = this.itemId(event, event.data?.['ordinal']);
    const item = this.items.get(id);
    if (!item) return;
    if (item.kind === 'message' || item.kind === 'reasoning') {
      this.items.set(id, { ...item, text: (item.text ?? '') + chunk });
    }
    this.events.push({ t: 'item.append', itemId: id, field, chunk });
  }

  private textEnded(event: NativeEvent, _kind: 'message' | 'reasoning'): void {
    const id = this.itemId(event, event.data?.['ordinal']);
    const item = this.items.get(id);
    if (!item) return;
    const text = str(event.data?.['text']);
    const shown = item.kind === 'message' || item.kind === 'reasoning' ? item.text : undefined;
    const next: Item =
      item.kind === 'message' || item.kind === 'reasoning'
        ? { ...item, text: text ?? shown ?? '', status: 'done', endedAt: Date.now() }
        : item;
    this.items.set(id, next);
    this.events.push({ t: 'item.upsert', item: next });
  }

  private toolId(event: NativeEvent): string {
    return `${str(event.data?.['assistantMessageID']) ?? 'msg'}:tool:${str(event.data?.['id']) ?? ''}`;
  }

  private toolStarted(event: NativeEvent): void {
    const native = str(event.data?.['id']) ?? '';
    const name = str(event.data?.['name']) ?? 'tool';
    this.toolNames.set(native, name);
    const id = this.toolId(event);
    const turnId = this.ensureTurn();
    this.messageOf.set(id, str(event.data?.['assistantMessageID']) ?? '');
    const body = toolBody(name, {});
    const item: Item = {
      id,
      turnId,
      status: 'running',
      startedAt: Date.now(),
      native: { agent: 'opencode', type: `tool:${name}`, ref: native },
      ...body,
    } as Item;
    this.items.set(id, item);
    this.events.push({ t: 'item.upsert', item });
  }

  private toolCalled(event: NativeEvent): void {
    const native = str(event.data?.['id']) ?? '';
    const name = this.toolNames.get(native) ?? 'tool';
    const input = obj(event.data?.['input']) ?? {};
    const id = this.toolId(event);
    const item = this.items.get(id);
    if (!item) return;
    const body = toolBody(name, input);
    const next = { ...item, ...body, status: 'running' as const };
    this.items.set(id, next);
    this.events.push({ t: 'item.upsert', item: next });
  }

  private toolFinished(event: NativeEvent, failed: boolean): void {
    const id = this.toolId(event);
    const item = this.items.get(id);
    if (!item) return;
    const output = failed
      ? (str(obj(event.data?.['error'])?.['message']) ?? 'failed')
      : arr(event.data?.['content'])
          .map((part) => str(obj(part)?.['text']) ?? '')
          .filter(Boolean)
          .join('\n');
    const next = {
      ...item,
      ...toolOutput(item, output),
      status: failed ? 'failed' : 'done',
      endedAt: Date.now(),
    } as Item;
    this.items.set(id, next);
    this.events.push({ t: 'item.upsert', item: next });
  }

  private permissionAsked(event: NativeEvent): void {
    const data = event.data ?? {};
    const requestId = str(data['id']);
    if (!requestId) return;
    if (this.mode !== 'ask') {
      void this.reply(requestId, 'once').catch(() => undefined);
      return;
    }
    const action = str(data['action']) ?? 'other';
    const resources = arr(data['resources']).map(String);
    const interaction: Interaction = {
      kind: 'approval',
      id: requestId,
      action: approvalAction(action, resources, data),
      choices: ['allow_once', 'allow_session', 'deny'],
    };
    this.interactions.set(requestId, { kind: 'permission', requestId });
    this.events.push({ t: 'interaction.opened', interaction });
    this.status('waiting');
  }

  private formCreated(event: NativeEvent): void {
    const form = obj(event.data?.['form']);
    const id = str(form?.['id']);
    if (!form || !id) return;
    if (str(event.data?.['sessionID']) && event.data?.['sessionID'] !== this.sessionId) return;
    if (str(form['sessionID']) && form['sessionID'] !== this.sessionId) return;
    const state = obj(form['state']);
    if (str(state?.['status']) && state?.['status'] !== 'pending') return;
    const kind = str(obj(form['metadata'])?.['kind']);
    const title = str(form['title']) ?? 'OpenCode';
    const fields = arr(form['fields'])
      .map((raw) => obj(raw))
      .filter((raw): raw is Record<string, unknown> => !!raw);

    if (kind === 'question') {
      const questions: Question[] = [];
      const values = new Map<string, Map<string, string>>();
      for (const [index, field] of fields.entries()) {
        const fieldId = str(field['key']) ?? String(index);
        const rawOptions = arr(field['options'])
          .map((raw) => obj(raw))
          .filter((raw): raw is Record<string, unknown> => !!raw)
          .filter((option) => (str(option['label']) ?? str(option['value']) ?? '').length > 0);
        const options = rawOptions
          .map((option) => ({
            label: str(option['label']) ?? str(option['value']) ?? '',
            ...(str(option['description']) ? { description: str(option['description']) } : {}),
            ...(str(option['preview']) ? { preview: str(option['preview']) } : {}),
          }))
          .filter((option) => option.label.length > 0);
        questions.push({
          id: fieldId,
          header: str(field['title']) ?? '',
          text: str(field['description']) ?? str(field['title']) ?? '',
          multi: field['type'] === 'multiselect',
          allowFreeText: field['custom'] === true,
          options,
        });
        const mapping = new Map<string, string>();
        for (const [optionIndex, option] of options.entries()) {
          mapping.set(option.label, str(rawOptions[optionIndex]?.['value']) ?? option.label);
        }
        values.set(fieldId, mapping);
      }
      this.interactions.set(id, { kind: 'question', formId: id, questions, values });
      this.events.push({
        t: 'interaction.opened',
        interaction: { kind: 'question', id, questions },
      });
      this.status('waiting');
      return;
    }

    const formFields: Extract<Interaction, { kind: 'form' }>['fields'] = [];
    const fieldTypes: Record<string, string> = {};
    for (const [index, field] of fields.entries()) {
      const fieldId = str(field['key']) ?? String(index);
      const options = arr(field['options'])
        .map((raw) => str(obj(raw)?.['value']) ?? str(obj(raw)?.['label']))
        .filter((value): value is string => !!value);
      const type = str(field['type']);
      const mapped: 'select' | 'number' | 'boolean' | 'text' =
        options.length > 0
          ? 'select'
          : type === 'number' || type === 'integer'
            ? 'number'
            : type === 'boolean'
              ? 'boolean'
              : 'text';
      formFields.push({
        id: fieldId,
        label: str(field['title']) ?? fieldId,
        type: mapped,
        ...(options.length ? { options } : {}),
      });
      fieldTypes[fieldId] = mapped;
    }
    this.interactions.set(id, { kind: 'form', formId: id, fields: fieldTypes });
    this.events.push({
      t: 'interaction.opened',
      interaction: { kind: 'form', id, server: 'opencode', title, fields: formFields },
    });
    this.status('waiting');
  }

  private formClosed(id: string | undefined, resolution: 'answered' | 'cancelled'): void {
    if (!id || !this.interactions.delete(id)) return;
    this.events.push({ t: 'interaction.closed', id, resolution });
    this.status('working');
  }

  private usage(data: Record<string, unknown>): void {
    const tokens = obj(data['tokens']) ?? {};
    const input = num(tokens['input']) ?? 0;
    const output = num(tokens['output']) ?? 0;
    if (input === 0 && output === 0) return;
    this.events.push({ t: 'usage', inputTokens: input, outputTokens: output });
  }
}

function parseModel(
  model: string,
  effort?: string,
): { providerID: string; id: string; variant?: string } {
  const [ref, suffix] = model.split('#');
  const variant = suffix ?? effort;
  const slash = ref?.indexOf('/') ?? -1;
  if (slash < 0)
    return { providerID: 'opencode', id: ref ?? model, ...(variant ? { variant } : {}) };
  return {
    providerID: ref!.slice(0, slash),
    id: ref!.slice(slash + 1),
    ...(variant ? { variant } : {}),
  };
}

function toolBody(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const lower = name.toLowerCase();
  if (lower === 'bash' || lower === 'shell' || lower === 'command') {
    return {
      kind: 'command',
      command: str(input['command']) ?? '',
      description: str(input['description']),
      output: '',
      outputLive: true,
    };
  }
  if (['read', 'glob', 'grep', 'list', 'ls', 'webfetch', 'websearch'].includes(lower)) {
    const op =
      lower === 'read'
        ? 'read'
        : lower === 'glob' || lower === 'grep'
          ? 'search'
          : lower === 'list' || lower === 'ls'
            ? 'list'
            : 'fetch';
    return {
      kind: 'explore',
      op,
      target:
        str(input['filePath']) ??
        str(input['path']) ??
        str(input['pattern']) ??
        str(input['url']) ??
        '',
      detail: str(input['description']) ?? str(input['query']) ?? undefined,
    };
  }
  if (['edit', 'write', 'patch', 'multiedit', 'apply_patch'].includes(lower)) {
    return {
      kind: 'file_change',
      files: [
        {
          path: str(input['filePath']) ?? str(input['path']) ?? 'file',
          change: lower === 'write' ? 'add' : 'update',
        },
      ],
    };
  }
  if (lower === 'task') {
    return {
      kind: 'task',
      title: str(input['description']) ?? str(input['prompt']) ?? 'subagent',
      agentType: str(input['subagent_type']),
    };
  }
  return { kind: 'tool', name, input: JSON.stringify(input) };
}

function toolOutput(item: Item, output: string): Record<string, unknown> {
  if (item.kind === 'command') return { output, outputLive: false };
  if (item.kind === 'explore') return { detail: output || undefined };
  if (item.kind === 'tool') return { output };
  if (item.kind === 'task') return { summary: output };
  return {};
}

function approvalAction(
  action: string,
  resources: string[],
  data: Record<string, unknown>,
): Extract<Interaction, { kind: 'approval' }>['action'] {
  const message = str(data['message']);
  if (action === 'bash' || action === 'shell') {
    return {
      type: 'command',
      title: 'Run a command',
      command: resources[0],
      ...(message ? { reason: message } : {}),
    };
  }
  if (action === 'edit' || action === 'write' || action === 'patch') {
    return {
      type: 'file_write',
      title: 'Change files',
      paths: resources,
      ...(message ? { reason: message } : {}),
    };
  }
  if (action === 'webfetch' || action === 'websearch') {
    return {
      type: 'network',
      title: 'Access the network',
      host: resources[0],
      ...(message ? { reason: message } : {}),
    };
  }
  return { type: 'other', title: message ?? action, ...(message ? { reason: message } : {}) };
}

function errorOf(value: unknown): AgentError | undefined {
  const error = obj(value);
  if (!error) return undefined;
  const type = (str(error['type']) ?? '').toLowerCase();
  const message = str(error['message']) ?? 'OpenCode failed';
  const category = type.includes('auth')
    ? 'auth'
    : type.includes('limit') || type.includes('rate')
      ? 'limit'
      : type.includes('network')
        ? 'network'
        : type.includes('context')
          ? 'context_overflow'
          : type.includes('refus')
            ? 'refusal'
            : 'other';
  return { category, message };
}
