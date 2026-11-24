import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { OrderService } from '../../../core/services/order.service';
import {
  ORDER_STATUS_LABELS,
  Order,
  OrderStatus,
  PAYMENT_STATUS_LABELS,
  PaymentStatus,
} from '../../../core/models/order';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

type Filter = 'all' | 'open' | 'unpaid' | OrderStatus;

@Component({
  selector: 'app-admin-orders-page',
  imports: [DatePipe, DecimalPipe, Shape],
  templateUrl: './admin-orders-page.html',
  styleUrl: './admin-orders-page.scss',
})
export class AdminOrdersPage {
  private readonly orders = inject(OrderService);

  protected readonly orderLabels = ORDER_STATUS_LABELS;
  protected readonly paymentLabels = PAYMENT_STATUS_LABELS;
  protected readonly orderStatuses = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
  protected readonly paymentStatuses = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'all', label: 'All' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'placed', label: 'Placed' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  protected readonly all = signal<Order[] | null>(null);
  protected readonly filter = signal<Filter>('open');
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly openId = signal<string | null>(null);
  protected readonly detail = signal<Order | null>(null);

  protected readonly list = computed(() => {
    const filter = this.filter();
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);

    return (this.all() ?? []).filter((order) => {
      if (
        filter === 'unpaid' &&
        (order.paymentStatus !== 'unpaid' || order.orderStatus === 'cancelled')
      )
        return false;
      // Open = placed or in progress: everything not yet completed or cancelled
      if (
        filter === 'open' &&
        order.orderStatus !== 'placed' &&
        order.orderStatus !== 'in_progress'
      )
        return false;
      if (
        filter !== 'all' &&
        filter !== 'open' &&
        filter !== 'unpaid' &&
        order.orderStatus !== filter
      )
        return false;

      const text = [order.orderNumber, order.customerName, order.customerEmail, order.customerPhone]
        .join(' ')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.all.set(await this.orders.adminList());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
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
      this.detail.set(await this.orders.adminGet(order.orderId));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async save(order: Order, orderStatus: string, paymentStatus: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.orders.adminUpdate(order.orderId, {
        orderStatus: orderStatus as OrderStatus,
        paymentStatus: paymentStatus as PaymentStatus,
      });
      this.detail.set(updated);
      this.all.update(
        (list) =>
          list?.map((o) => (o.orderId === updated.orderId ? { ...o, ...updated } : o)) ?? null,
      );
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
