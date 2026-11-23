import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../../../core/services/order.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { ORDER_STATUS_LABELS, Order, PAYMENT_STATUS_LABELS } from '../../../core/models/order';
import { BankTransfer } from '../../../shared/components/bank-transfer/bank-transfer';

@Component({
  selector: 'app-profile-orders-page',
  imports: [RouterLink, DatePipe, DecimalPipe, BankTransfer],
  templateUrl: './profile-orders-page.html',
  styleUrl: './profile-orders-page.scss',
})
export class ProfileOrdersPage {
  private readonly orders = inject(OrderService);

  protected readonly orderLabels = ORDER_STATUS_LABELS;
  protected readonly paymentLabels = PAYMENT_STATUS_LABELS;

  protected readonly list = signal<Order[] | null>(null);
  protected readonly error = signal<string | null>(null);

  // The order opened below its row, with its lines
  protected readonly openId = signal<string | null>(null);
  protected readonly detail = signal<Order | null>(null);

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.list.set(await this.orders.list());
    } catch (error) {
      this.error.set(authErrorMessage(error));
    }
  }

  protected async toggle(order: Order): Promise<void> {
    if (this.openId() === order.orderId) {
      this.openId.set(null);
      return;
    }

    this.openId.set(order.orderId);
    this.detail.set(null);
    try {
      this.detail.set(await this.orders.get(order.orderId));
    } catch (error) {
      this.error.set(authErrorMessage(error));
    }
  }
}
