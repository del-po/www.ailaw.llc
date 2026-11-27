import { Component, afterNextRender, input, signal } from '@angular/core';
import { ActionPart, ActionState } from '../../../core/models/chat';
import { authErrorMessage } from '../../../core/services/auth-errors';

// A change the chat proposed: what will happen, and Confirm / Cancel. Only
// Confirm runs it (through the same door action as its button would). Used
// by every side's chat; `chat` is that side's chat service.
// What the card needs from a side's chat service (client, lawyer, admin)
export interface ActionDoor {
  confirmAction(actionId: string): Promise<ActionState>;
  cancelAction(actionId: string): Promise<ActionState>;
  actionStatus(actionId: string): Promise<ActionState>;
}

@Component({
  selector: 'app-action-card',
  templateUrl: './action-card.html',
  styleUrl: './action-card.scss',
})
export class ActionCard {
  readonly part = input.required<ActionPart>();
  readonly chat = input.required<ActionDoor>();

  protected readonly state = signal<ActionState | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    // A card from an earlier visit may already be confirmed or cancelled
    afterNextRender(() => {
      this.chat()
        .actionStatus(this.part().actionId)
        .then((s) => this.state.set(s))
        .catch(() => this.state.set({ status: 'pending', result: null, error: '' }));
    });
  }

  protected async confirm(): Promise<void> {
    if (this.part().danger && !confirm(`${this.part().title}?\n\nThis can't be undone.`)) return;
    await this.run(() => this.chat().confirmAction(this.part().actionId));
  }

  protected async cancel(): Promise<void> {
    await this.run(() => this.chat().cancelAction(this.part().actionId));
  }

  protected message(code: string): string {
    return authErrorMessage(new Error(code)) ?? code;
  }

  private async run(step: () => Promise<ActionState>): Promise<void> {
    this.busy.set(true);
    try {
      this.state.set(await step());
    } catch (error) {
      this.state.set({ status: 'failed', result: null, error: (error as Error).message });
    } finally {
      this.busy.set(false);
    }
  }
}
