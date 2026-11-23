import {
  Component,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Icon } from '../../kit/icon/icon';

export interface ChatSubmit {
  text: string;
  files: File[];
}

const MAX_HEIGHT = 200;

@Component({
  selector: 'app-chat-input',
  imports: [Icon],
  templateUrl: './chat-input.html',
  styleUrl: './chat-input.scss',
})
export class ChatInput {
  readonly placeholder = input('Ask a legal question…');
  readonly disabled = input(false);
  readonly text = model('');
  readonly submitted = output<ChatSubmit>();

  protected readonly files = model<File[]>([]);
  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    // Re-measure after the text changes from outside too (sending, editing a message)
    effect(() => {
      this.text();
      if (this.isBrowser) requestAnimationFrame(() => this.resize());
    });
  }

  focus(): void {
    this.box().nativeElement.focus();
  }

  protected onInput(value: string): void {
    this.text.set(value);
  }

  // Enter sends, Shift+Enter makes a new line
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  protected onFilesPicked(picker: HTMLInputElement): void {
    const picked = Array.from(picker.files ?? []);
    this.files.update((list) => [...list, ...picked]);
    picker.value = ''; // lets the same file be picked again
  }

  protected removeFile(file: File): void {
    this.files.update((list) => list.filter((f) => f !== file));
  }

  protected submit(): void {
    const text = this.text().trim();
    if (this.disabled() || (!text && !this.files().length)) return;

    this.submitted.emit({ text, files: this.files() });
    this.text.set('');
    this.files.set([]);
  }

  // Grows with the text up to MAX_HEIGHT, then scrolls
  private resize(): void {
    const box = this.box().nativeElement;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, MAX_HEIGHT) + 'px';
  }
}
