import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { AdminChatService } from '../../../core/services/admin-chat.service';
import { ChatInput, ChatSubmit } from '../../../shared/components/chat-input/chat-input';
import { formatMessage } from '../../chat-page/format-message';

// The admin's chat: the start page of the admin Workspace. Conversations
// are listed in the sidebar (AdminLayout); this shows the open one.
@Component({
  selector: 'app-admin-chat-page',
  imports: [ChatInput],
  templateUrl: './admin-chat-page.html',
  styleUrl: './admin-chat-page.scss',
})
export class AdminChatPage {
  protected readonly chat = inject(AdminChatService);
  protected readonly format = formatMessage;
  protected readonly messages = computed(() => this.chat.active()?.messages ?? []);

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  constructor() {
    // New text: stay at the latest message
    effect(() => {
      this.messages();
      queueMicrotask(() => {
        const el = this.thread()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected send({ text, files }: ChatSubmit): void {
    if (text.trim()) this.chat.send(text, files);
  }
}
