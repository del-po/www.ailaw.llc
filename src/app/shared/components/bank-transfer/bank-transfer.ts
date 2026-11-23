import { Component, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BANK_TRANSFER } from '../../../core/config/payment.config';

// Payment instructions for an unpaid order: who to pay, where, how much and the reference
@Component({
  selector: 'app-bank-transfer',
  imports: [DecimalPipe],
  templateUrl: './bank-transfer.html',
  styleUrl: './bank-transfer.scss',
})
export class BankTransfer {
  readonly amount = input.required<number>();
  readonly currency = input.required<string>();
  readonly reference = input.required<string>(); // the order number

  protected readonly bank = BANK_TRANSFER;
  protected readonly copied = signal<string | null>(null);

  protected async copy(key: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(key);
      setTimeout(() => this.copied.set(null), 1500);
    } catch {
      // Clipboard blocked by the browser: the text can still be selected by hand
    }
  }
}
