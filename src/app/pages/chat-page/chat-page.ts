import {
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatService } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { ChatMessage } from '../../core/models/chat';
import { ChatInput, ChatSubmit } from '../../shared/components/chat-input/chat-input';
import { Icon } from '../../shared/kit/icon/icon';
import { Header } from '../../shared/components/header/header';
import { BankTransfer } from '../../shared/components/bank-transfer/bank-transfer';
import { formatMessage } from './format-message';

// How close to the bottom (px) still counts as "reading the latest message"
const STICK_DISTANCE = 80;

@Component({
  selector: 'app-chat-page',
  imports: [RouterLink, ChatInput, Icon, Header, BankTransfer],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.scss',
  host: {
    '(document:keydown.escape)': 'sidebarOpen.set(false)',
  },
})
export class ChatPage {
  protected readonly chat = inject(ChatService);
  private readonly theme = inject(ThemeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly input = viewChild.required(ChatInput);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly loggedIn = inject(AuthService).signedIn;

  protected readonly robot = computed(() =>
    this.theme.isDark() ? 'images/home-img/robot-dark.webp' : 'images/home-img/robot-light.webp',
  );

  // History drawer on smaller screens
  protected readonly sidebarOpen = signal(false);

  // ---------- Conversation ----------

  protected readonly messages = computed(() => this.chat.active()?.messages ?? []);
  // An open conversation (even one still loading) replaces the start screen
  protected readonly chatting = computed(() => !!this.chat.active() || this.messages().length > 0);
  protected readonly hasHistory = computed(() => this.chat.conversations().length > 0);

  protected readonly draft = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly copiedId = signal<string | null>(null);

  protected readonly format = formatMessage;

  protected submit({ text, files }: ChatSubmit): void {
    const editing = this.editingId();
    this.editingId.set(null);
    this.stickToBottom = true;

    if (editing) {
      this.chat.edit(editing, text);
    } else {
      this.chat.send(text, files);
    }
  }

  protected newChat(): void {
    this.chat.newChat();
    this.cancelEdit();
    this.sidebarOpen.set(false);
    this.input().focus();
  }

  protected openChat(id: string): void {
    this.chat.open(id);
    this.cancelEdit();
    this.sidebarOpen.set(false);
    this.stickToBottom = true;
  }

  protected removeChat(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.chat.remove(id);
  }

  protected startEdit(message: ChatMessage): void {
    this.editingId.set(message.id);
    this.draft.set(this.textOf(message));
    this.input().focus();
  }

  protected cancelEdit(): void {
    if (!this.editingId()) return;
    this.editingId.set(null);
    this.draft.set('');
  }

  protected async copy(message: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.textOf(message));
      this.copiedId.set(message.id);
      setTimeout(() => this.copiedId.set(null), 1500);
    } catch {
      // Clipboard blocked by the browser: nothing to copy to
    }
  }

  protected focusInput(): void {
    this.input().focus();
  }

  private textOf(message: ChatMessage): string {
    return message.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
  }

  // ---------- Scrolling ----------

  // Follows new text only while the reader is at the bottom
  private stickToBottom = true;

  protected onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_DISTANCE;
  }

  constructor() {
    effect(() => {
      this.messages();
      const el = this.scroller()?.nativeElement;
      if (!this.isBrowser || !el || !this.stickToBottom) return;
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    });

    // A question sent from the home page arrives as ?q=…
    afterNextRender(() => {
      const question = this.route.snapshot.queryParamMap.get('q');
      if (!question) return;

      this.chat.newChat();
      this.chat.send(question);
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    });
  }
}
