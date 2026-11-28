import { Component, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import {
  ConversationDetail,
  ConversationMessage,
  ConversationRow,
  Period,
  Side,
} from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { SIDE_LABELS } from '../admin-ai-page/admin-ai-page';
import { AdminPeriod, lastDays } from '../admin-period/admin-period';
import { adminErrorMessage } from '../admin-links';

// Communications: every conversation on the platform, the ones needing a
// person first in mind; open one to read it, answer as the AI Law team, or
// mark an answer as an AI mistake
@Component({
  selector: 'app-admin-communications-page',
  imports: [DatePipe, RouterLink, Shape, AdminPeriod],
  templateUrl: './admin-communications-page.html',
  styleUrl: './admin-communications-page.scss',
})
export class AdminCommunicationsPage {
  private readonly admin = inject(AdminService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly sides: (Side | '')[] = ['', 'client', 'lawyer', 'admin'];
  protected readonly sideLabels: Record<string, string> = { '': 'All', ...SIDE_LABELS };

  protected readonly period = signal<Period>(lastDays(30));
  protected readonly side = signal<Side | ''>('');
  protected readonly attention = signal(false);
  protected readonly query = signal('');

  protected readonly list = signal<ConversationRow[] | null>(null);
  protected readonly open = signal<ConversationDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  // The answer whose "mistake" form is open
  protected readonly flagging = signal<string | null>(null);

  constructor() {
    const first = inject(ActivatedRoute).snapshot.queryParamMap.get('open');
    effect(() => {
      const filters = {
        ...this.period(),
        side: this.side(),
        attention: this.attention(),
        query: this.query(),
      };
      if (this.isBrowser) this.load(filters);
    });
    if (first && this.isBrowser) this.show(first);
  }

  private async load(filters: Parameters<AdminService['conversations']>[0]): Promise<void> {
    this.error.set(null);
    try {
      this.list.set(await this.admin.conversations(filters));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async show(id: string): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.flagging.set(null);
    try {
      this.open.set(await this.admin.conversation(id));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // Runs one change on the open conversation; the list shows it too
  private async run(change: () => Promise<ConversationDetail>, done: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const c = await change();
      this.open.set(c);
      this.list.update((rows) => rows?.map((r) => (r.id === c.id ? { ...r, ...c } : r)) ?? null);
      this.notice.set(done);
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async reply(area: HTMLTextAreaElement, email: boolean): Promise<void> {
    const c = this.open();
    if (!c || !area.value.trim()) return;
    const done = await this.run(
      () => this.admin.replyInConversation(c.id, area.value.trim(), email),
      email ? 'Sent in the chat and by email.' : 'Sent in the chat.',
    );
    if (done) area.value = '';
  }

  protected mark(needsHuman: boolean): Promise<boolean> {
    const c = this.open()!;
    return this.run(
      () => this.admin.setAttention(c.id, needsHuman),
      needsHuman ? 'Marked as needing a person.' : 'Marked as settled.',
    );
  }

  protected async flag(m: ConversationMessage, note: string): Promise<void> {
    const c = this.open();
    if (!c) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.flagMistake(c.id, m.id, note.trim());
      this.open.set(await this.admin.conversation(c.id));
      this.flagging.set(null);
      this.notice.set('Marked as an AI mistake: it is listed in AI Management → Mistakes.');
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
