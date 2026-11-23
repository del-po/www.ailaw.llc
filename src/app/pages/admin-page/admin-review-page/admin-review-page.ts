import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { ChatService } from '../../../core/services/chat.service';
import { LawyerTask } from '../../../core/models/chat';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

// The lawyer's queue: service steps the chat can't do, oldest first.
// Marking one done lets the chat continue the order on its own.
@Component({
  selector: 'app-admin-review-page',
  imports: [DatePipe, DecimalPipe, KeyValuePipe, Shape],
  templateUrl: './admin-review-page.html',
  styleUrl: './admin-review-page.scss',
})
export class AdminReviewPage {
  private readonly chat = inject(ChatService);

  protected readonly tasks = signal<LawyerTask[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busyKey = signal<string | null>(null);

  // Keeps the details in the order they were asked
  protected readonly keepOrder = () => 0;

  constructor() {
    afterNextRender(() => this.load());
  }

  protected key(task: LawyerTask): string {
    return task.orderId + '#' + task.stepNo;
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.tasks.set(await this.chat.tasks());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      this.tasks.set([]);
    }
  }

  protected async complete(event: SubmitEvent, task: LawyerTask): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const value = (name: string) =>
      ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').trim();

    this.busyKey.set(this.key(task));
    this.error.set(null);
    try {
      this.tasks.set(
        await this.chat.completeStep(task.orderId, task.stepNo, value('result'), value('note')),
      );
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busyKey.set(null);
    }
  }
}
