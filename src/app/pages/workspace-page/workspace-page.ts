import {
  Component,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { authErrorMessage } from '../../core/services/auth-errors';
import { readUpload } from '../../core/services/read-upload';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ChatMessage } from '../../core/models/chat';
import { Assignment, CaseView, Earnings, LawyerProfile, StaffMe } from '../../core/models/lawyer';
import { ChatInput, ChatSubmit } from '../../shared/components/chat-input/chat-input';
import { Shape } from '../../shared/kit/shapes/shape';
import { formatMessage } from '../chat-page/format-message';

// The lawyer's Workspace: assignments on the left (open first, then done),
// and on the right either the chosen case (details, documents, the case
// chat, delivery) or the lawyer's own profile and earnings.
@Component({
  selector: 'app-workspace-page',
  imports: [DatePipe, DecimalPipe, Shape, ChatInput],
  templateUrl: './workspace-page.html',
  styleUrl: './workspace-page.scss',
})
export class WorkspacePage {
  private readonly auth = inject(AuthService);
  private readonly workspace = inject(WorkspaceService);
  private readonly router = inject(Router);
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  protected readonly me = signal<StaffMe | null>(null);
  protected readonly assignments = signal<Assignment[] | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly view = signal<'case' | 'profile'>('case');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  // ---------- The open case ----------

  protected readonly current = signal<CaseView | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly asking = signal(false);

  // ---------- Profile ----------

  protected readonly profile = signal<LawyerProfile | null>(null);
  protected readonly earnings = signal<Earnings | null>(null);

  protected readonly open = computed(() =>
    (this.assignments() ?? []).filter((a) => a.status !== 'done'),
  );
  protected readonly done = computed(() =>
    (this.assignments() ?? []).filter((a) => a.status === 'done'),
  );
  protected readonly selected = computed(
    () => this.assignments()?.find((a) => a.assignmentId === this.selectedId()) ?? null,
  );
  protected readonly detailRows = computed(() =>
    Object.entries(this.current()?.details ?? {}).map(([key, value]) => ({
      label: key.replace(/_/g, ' '),
      value: String(value),
    })),
  );

  protected readonly format = formatMessage;

  constructor() {
    afterNextRender(() => this.load());
  }

  private async load(): Promise<void> {
    try {
      // Who I am first: it also activates a newly approved lawyer
      this.me.set(await this.workspace.me());
      await this.refresh();
    } catch {
      this.error.set(
        'Your Workspace could not be opened. If this keeps happening, contact AI Law.',
      );
    }
  }

  protected async refresh(): Promise<void> {
    const list = await this.workspace.assignments();
    this.assignments.set(list);
    // Opens the newest open assignment the first time
    if (!this.selectedId() && list.length) {
      await this.select(list.find((a) => a.status !== 'done') ?? list[0]);
    }
  }

  protected async select(assignment: Assignment): Promise<void> {
    this.view.set('case');
    this.selectedId.set(assignment.assignmentId);
    this.current.set(null);
    this.messages.set([]);
    this.clearMessages();
    try {
      const view = await this.workspace.openCase(assignment.assignmentId);
      if (this.selectedId() !== assignment.assignmentId) return;
      this.current.set(view);
      this.messages.set(view.chat.messages);
      this.patchAssignment(view.assignment);
      this.scrollDown();
    } catch (error) {
      this.error.set(authErrorMessage(error) ?? 'Something went wrong.');
    }
  }

  protected tasks(assignment: Assignment): string[] {
    // "1. File the declaration…" → "File the declaration…": the list numbers them
    return assignment.tasks
      .split('\n')
      .map((t) => t.trim().replace(/^\d+\.\s*/, ''))
      .filter(Boolean);
  }

  // ---------- Documents ----------

  protected async download(path: string): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    try {
      const file = await this.workspace.download(id, path);
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      this.error.set(authErrorMessage(error) ?? 'Something went wrong.');
    }
  }

  protected async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    const id = this.selectedId();
    if (!file || !id) return;
    await this.run(async () => {
      const documents = await this.workspace.upload(id, await readUpload(file));
      this.current.update((view) => (view ? { ...view, documents } : view));
      this.notice.set(`“${file.name}” is in your working folder.`);
    });
    input.value = '';
  }

  // ---------- Delivery ----------

  protected async deliver(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const id = this.selectedId();
    const file = (form.elements.namedItem('result') as HTMLInputElement).files?.[0];
    const note = (form.elements.namedItem('note') as HTMLTextAreaElement).value.trim();
    if (!id || !file) return;
    if (!confirm(`Send “${file.name}” to the client? This completes your assignment.`)) return;

    await this.run(async () => {
      const view = await this.workspace.deliver(id, await readUpload(file), note);
      this.current.set({ ...view, chat: { id: view.chat.id, messages: this.messages() } });
      this.patchAssignment(view.assignment);
      this.notice.set('Delivered. The client has the document in their account and by email.');
    });
  }

  // ---------- Case chat ----------

  protected async ask(submit: ChatSubmit): Promise<void> {
    const id = this.selectedId();
    const text = submit.text.trim();
    if (!id || !text || this.asking()) return;

    const draftId = 'draft-' + Date.now();
    this.asking.set(true);
    this.messages.update((list) => [
      ...list,
      { id: 'q-' + draftId, role: 'user', parts: [{ type: 'text', text }], createdAt: Date.now() },
      {
        id: draftId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt: Date.now(),
        streaming: true,
      },
    ]);
    this.scrollDown();

    try {
      await this.workspace.ask(id, text, (event) => {
        if (event.type === 'text') {
          this.updateDraft(draftId, (m) => ({
            ...m,
            parts: [{ type: 'text', text: textOf(m) + event.text }],
          }));
          this.scrollDown();
        } else if (event.type === 'done') {
          this.updateDraft(draftId, () => event.reply);
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      });
    } catch (error) {
      this.updateDraft(draftId, (m) => ({
        ...m,
        streaming: false,
        failed: true,
        parts: [
          {
            type: 'text',
            text: authErrorMessage(error) ?? 'The answer did not arrive. Try again.',
          },
        ],
      }));
    } finally {
      this.asking.set(false);
    }
  }

  // ---------- Profile ----------

  protected async openProfile(): Promise<void> {
    this.view.set('profile');
    this.selectedId.set(null);
    this.clearMessages();
    try {
      const { profile, earnings } = await this.workspace.profile();
      this.profile.set(profile);
      this.earnings.set(earnings);
    } catch (error) {
      this.error.set(authErrorMessage(error) ?? 'Something went wrong.');
    }
  }

  protected async saveProfile(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    await this.run(async () => {
      const { profile, earnings } = await this.workspace.updateProfile({
        phone: field('phone'),
        address: field('address'),
        languages: field('languages'),
        specializations: field('specializations'),
        availability: field('availability'),
        bio: field('bio'),
        iban: field('iban'),
      });
      this.profile.set(profile);
      this.earnings.set(earnings);
      (form.elements.namedItem('iban') as HTMLInputElement).value = '';
      this.notice.set('Your profile is saved.');
    });
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  // ---------- Helpers ----------

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(authErrorMessage(error) ?? 'Something went wrong.');
    } finally {
      this.busy.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private patchAssignment(updated: Assignment): void {
    this.assignments.update(
      (list) => list?.map((a) => (a.assignmentId === updated.assignmentId ? updated : a)) ?? null,
    );
  }

  private updateDraft(id: string, change: (m: ChatMessage) => ChatMessage): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? change(m) : m)));
  }

  private scrollDown(): void {
    requestAnimationFrame(() => {
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}

function textOf(message: ChatMessage): string {
  const part = message.parts.find((p) => p.type === 'text');
  return part && part.type === 'text' ? part.text : '';
}
