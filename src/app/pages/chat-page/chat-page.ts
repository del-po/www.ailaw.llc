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
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatService } from '../../core/services/chat.service';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { ChatMessage, DeclarationPart, DocumentPart } from '../../core/models/chat';
import { OrderService } from '../../core/services/order.service';
import { ActionCard } from '../../shared/components/action-card/action-card';
import { DeclarationsService } from '../../core/services/declarations.service';
import { authErrorMessage } from '../../core/services/auth-errors';
import { ChatInput, ChatSubmit } from '../../shared/components/chat-input/chat-input';
import { Icon } from '../../shared/kit/icon/icon';
import { Header } from '../../shared/components/header/header';
import { BankTransfer } from '../../shared/components/bank-transfer/bank-transfer';
import { formatMessage } from './format-message';

// How close to the bottom (px) still counts as "reading the latest message"
const STICK_DISTANCE = 80;

@Component({
  selector: 'app-chat-page',
  imports: [RouterLink, DecimalPipe, ChatInput, Icon, Header, BankTransfer, ActionCard],
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
    this.theme.isDark()
      ? 'images/chat-img/robot-profile-dark.png'
      : 'images/chat-img/robot-profile-light.png',
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

  // ---------- A client's file the chat shows ----------

  private readonly orders = inject(OrderService);
  protected readonly downloading = signal<string | null>(null);

  protected async download(part: DocumentPart): Promise<void> {
    this.downloading.set(part.fileId);
    try {
      const result = await this.orders.document(part.fileId);
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // The chat stays as it is; the file is also on the Documents page
    } finally {
      this.downloading.set(null);
    }
  }

  // ---------- 1% declarations cards ----------

  private readonly declarations = inject(DeclarationsService);
  // Per draft: 'saving', 'saved' or an error message
  protected readonly cardState = signal<Record<string, string>>({});

  protected async confirmDeclaration(part: DeclarationPart): Promise<void> {
    this.cardState.update((s) => ({ ...s, [part.draftId]: 'saving' }));
    try {
      await this.declarations.confirm(part.draftId);
      this.cardState.update((s) => ({ ...s, [part.draftId]: 'saved' }));
    } catch (error) {
      const code = (error as Error)?.message;
      this.cardState.update((s) => ({
        ...s,
        [part.draftId]:
          code === 'ALREADY_CONFIRMED'
            ? 'saved'
            : (authErrorMessage(error) ?? 'Something went wrong.'),
      }));
    }
  }

  // Opens the profile form with the card's entries, to correct them
  protected editDeclaration(part: DeclarationPart): void {
    this.router.navigate(['/profile/declarations'], { queryParams: { draft: part.draftId } });
  }

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
