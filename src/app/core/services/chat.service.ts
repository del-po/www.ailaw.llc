import { Service, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActionState, ChatMessage, Conversation, LawyerTask, MessagePart } from '../models/chat';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

// Visitors who aren't signed in get a random id, kept in this browser
const GUEST_KEY = 'ailaw.guest';

interface ServerConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages?: ChatMessage[];
}

// Events streamed by "chat:send", one JSON object per line
type SendEvent =
  | { type: 'start'; conversationId: string; title: string; userMessage: ChatMessage }
  | { type: 'text'; text: string }
  | { type: 'part'; part: MessagePart }
  | { type: 'done'; reply: ChatMessage }
  | { type: 'error'; error: string };

// Server error codes the client can see, in plain words
const ERRORS: Record<string, string> = {
  LIMIT_REACHED: 'You have reached today’s question limit. Please come back tomorrow.',
  GUEST_LIMIT_REACHED:
    'You have used today’s free questions. Log in to keep asking, it’s free.',
  ACCOUNT_SUSPENDED: 'Your account is suspended. Please contact us.',
  AI_UNAVAILABLE: 'The assistant is unavailable right now. Please try again in a minute.',
};

@Service()
export class ChatService {
  // Which side's chat this is: the website's (client) or another door's
  protected readonly door: string = DOORS.client;
  private readonly auth = inject(AuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly conversations = signal<Conversation[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(false);

  readonly active = computed(
    () => this.conversations().find((c) => c.id === this.activeId()) ?? null,
  );

  // Draft conversation shown before the server has given it an id
  private readonly draftId = 'draft';

  // Whose history is shown: the signed-in user's id, or null for a guest
  private readonly uid = computed(() => (this.auth.ready() ? (this.auth.user()?.uid ?? null) : undefined));
  private shownFor: string | null | undefined = undefined;

  constructor() {
    // History belongs to whoever is using the chat: reload it when they sign in or out
    effect(() => {
      const uid = this.uid();
      if (!this.isBrowser || uid === undefined) return;

      // A different person: the previous history must not stay on screen
      if (this.shownFor !== undefined && this.shownFor !== uid) {
        this.conversations.set([]);
        this.activeId.set(null);
      }
      this.shownFor = uid;
      this.loadList();
    });
  }

  // ---------- Conversations ----------

  async loadList(): Promise<void> {
    try {
      const list = await this.call<ServerConversation[]>('chat:list');
      // Keeps conversations already open here (e.g. one started from the home page)
      this.conversations.update((current) => {
        const known = new Set(current.map((c) => c.id));
        const fresh = list
          .filter((c) => !known.has(c.id))
          .map((c) => ({ ...c, messages: [], loaded: false }));
        return [...current, ...fresh].sort((a, b) => b.updatedAt - a.updatedAt);
      });
    } catch {
      // History unavailable: the chat still works, the sidebar stays empty
    }
  }

  newChat(): void {
    this.activeId.set(null);
  }

  async open(id: string): Promise<void> {
    this.activeId.set(id);
    const conversation = this.conversations().find((c) => c.id === id);
    if (!conversation || conversation.loaded) return;

    this.loading.set(true);
    try {
      const full = await this.call<ServerConversation>('chat:get', { conversationId: id });
      this.updateConversation(id, (c) => ({ ...c, messages: full.messages ?? [], loaded: true }));
    } catch {
      this.updateConversation(id, (c) => ({ ...c, loaded: false }));
    } finally {
      this.loading.set(false);
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    this.updateConversation(id, (c) => ({ ...c, title: clean }));
    await this.call('chat:rename', { conversationId: id, title: clean }).catch(() => undefined);
  }

  async remove(id: string): Promise<void> {
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.activeId() === id) this.activeId.set(null);
    await this.call('chat:delete', { conversationId: id }).catch(() => undefined);
  }

  // ---------- Messages ----------

  // Files are shown in the message for now; reading them comes with a later capability
  async send(text: string, files: File[] = []): Promise<void> {
    const question = text.trim();
    if (!question || this.busy()) return;

    const parts: MessagePart[] = [
      ...files.map((f) => ({ type: 'file' as const, name: f.name, size: f.size })),
      { type: 'text', text: question },
    ];
    await this.ask(question, parts);
  }

  // Replaces a sent question and everything after it, then asks again
  async edit(messageId: string, text: string): Promise<void> {
    const conversation = this.active();
    const question = text.trim();
    if (!conversation || !question || this.busy()) return;

    const index = conversation.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    this.updateConversation(conversation.id, (c) => ({
      ...c,
      messages: c.messages.slice(0, index),
    }));
    await this.ask(question, [{ type: 'text', text: question }], messageId);
  }

  // ---------- Proposed actions (cards with Confirm / Cancel) ----------

  confirmAction(actionId: string): Promise<ActionState> {
    return this.call('chat:confirmAction', { actionId });
  }

  cancelAction(actionId: string): Promise<ActionState> {
    return this.call('chat:cancelAction', { actionId });
  }

  actionStatus(actionId: string): Promise<ActionState> {
    return this.call('chat:actionStatus', { actionId });
  }

  // ---------- Lawyer tasks (admin door) ----------

  tasks(): Promise<LawyerTask[]> {
    return this.call('admin:tasks', {}, DOORS.admin);
  }

  completeStep(orderId: string, stepNo: number, result = '', note = ''): Promise<LawyerTask[]> {
    return this.call('admin:completeStep', { orderId, stepNo, result, note }, DOORS.admin);
  }

  // ---------- Internals ----------

  private async ask(question: string, parts: MessagePart[], replaceFrom?: string): Promise<void> {
    // A draft whose first question failed has no server id yet
    const active = this.activeId();
    const existing = active === this.draftId ? null : active;
    const conversationId = existing ?? this.startDraft(question);

    const temp = this.message('user', parts);
    const answer = this.message('assistant', [{ type: 'text', text: '' }]);
    answer.streaming = true;
    this.appendMessages(conversationId, [temp, answer]);
    this.busy.set(true);

    // The conversation's id once the server has given one (a new chat starts as the draft)
    let id = conversationId;

    try {
      await this.stream(
        { conversationId: existing ?? undefined, text: question, replaceFromMessageId: replaceFrom },
        (event) => {
          switch (event.type) {
            case 'start': {
              if (!existing) {
                id = event.conversationId;
                this.conversations.update((list) =>
                  list.map((c) =>
                    c.id === this.draftId ? { ...c, id, title: event.title, loaded: true } : c,
                  ),
                );
                if (this.activeId() === this.draftId) this.activeId.set(id);
              }
              // Keep the files shown on the question; the server stores the text only
              const files = parts.filter((p) => p.type === 'file');
              const userMessage = { ...event.userMessage, parts: [...files, ...event.userMessage.parts] };
              this.updateMessage(id, temp.id, () => userMessage);
              this.moveToTop(id);
              break;
            }
            case 'text':
              this.updateMessage(id, answer.id, (m) => {
                const [first, ...rest] = m.parts;
                const text = (first?.type === 'text' ? first.text : '') + event.text;
                return { ...m, parts: [{ type: 'text', text }, ...rest] };
              });
              break;
            case 'part':
              this.updateMessage(id, answer.id, (m) => ({ ...m, parts: [...m.parts, event.part] }));
              break;
            case 'done':
              this.updateMessage(id, answer.id, () => ({ ...event.reply, streaming: false }));
              this.updateConversation(id, (c) => ({ ...c, updatedAt: Date.now() }));
              break;
            case 'error':
              throw new Error(event.error);
          }
        },
      );
    } catch (error) {
      // A failed first question isn't saved on the server: the chat stays a draft
      if (!existing && id !== this.draftId) {
        const serverId = id;
        id = this.draftId;
        this.conversations.update((list) =>
          list.map((c) => (c.id === serverId ? { ...c, id: this.draftId } : c)),
        );
        if (this.activeId() === serverId) this.activeId.set(this.draftId);
      }

      const code = (error as Error).message;
      this.updateMessage(id, answer.id, (m) => ({
        ...m,
        failed: true,
        streaming: false,
        parts: [{ type: 'text', text: ERRORS[code] ?? 'Sorry, something went wrong. Please try again.' }],
      }));
    } finally {
      this.busy.set(false);
    }
  }

  private startDraft(question: string): string {
    if (this.activeId() === this.draftId) return this.draftId; // retrying in the same draft

    const conversation: Conversation = {
      id: this.draftId,
      title: question.length > 40 ? question.slice(0, 40).trimEnd() + '…' : question,
      updatedAt: Date.now(),
      messages: [],
      loaded: true,
    };
    this.conversations.update((list) => [conversation, ...list.filter((c) => c.id !== this.draftId)]);
    this.activeId.set(this.draftId);
    return this.draftId;
  }

  private moveToTop(id: string): void {
    this.conversations.update((list) => {
      const item = list.find((c) => c.id === id);
      return item ? [item, ...list.filter((c) => c.id !== id)] : list;
    });
  }

  private message(role: ChatMessage['role'], parts: MessagePart[]): ChatMessage {
    return { id: crypto.randomUUID(), role, parts, createdAt: Date.now() };
  }

  private appendMessages(conversationId: string, messages: ChatMessage[]): void {
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: [...c.messages, ...messages],
      updatedAt: Date.now(),
    }));
  }

  private updateMessage(
    conversationId: string,
    messageId: string,
    change: (m: ChatMessage) => ChatMessage,
  ): void {
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? change(m) : m)),
    }));
  }

  private updateConversation(id: string, change: (c: Conversation) => Conversation): void {
    this.conversations.update((list) => list.map((c) => (c.id === id ? change(c) : c)));
  }

  private guestId(): string {
    try {
      let id = localStorage.getItem(GUEST_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(GUEST_KEY, id);
      }
      return id;
    } catch {
      return crypto.randomUUID(); // storage blocked: a new guest each visit
    }
  }

  private async body(action: string, data: object): Promise<string> {
    await this.auth.whenReady();
    const idToken = this.auth.user() ? await this.auth.idToken() : null;
    return JSON.stringify(
      idToken ? { action, idToken, data } : { action, guestId: this.guestId(), data },
    );
  }

  private async call<T>(action: string, data: object = {}, door: string = this.door): Promise<T> {
    const res = await fetch(door, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await this.body(action, data),
    });
    const result = (await res.json()) as DoorResult<T>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  // Reads the answer as it is written: one JSON event per line
  private async stream(data: object, onEvent: (event: SendEvent) => void): Promise<void> {
    const res = await fetch(this.door, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await this.body('chat:send', data),
    });
    if (!res.ok || !res.body) throw new Error('SERVER_ERROR');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as SendEvent;
        if (event.type === 'done') finished = true;
        onEvent(event);
      }
      if (done) break;
    }

    // The connection closed before the answer was complete
    if (!finished) throw new Error('SERVER_ERROR');
  }
}
