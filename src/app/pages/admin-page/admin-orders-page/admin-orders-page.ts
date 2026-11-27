import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { OrderService } from '../../../core/services/order.service';
import {
  ORDER_STATUS_LABELS,
  Order,
  OrderStatus,
  PAYMENT_STATUS_LABELS,
  PaymentStatus,
} from '../../../core/models/order';
import { AdminServiceRow } from '../../../core/models/admin';
import { AdminLawyer } from '../../../core/models/lawyer';
import { Profile } from '../../../core/models/profile';
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
  private readonly admin = inject(AdminService);

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
  protected readonly notice = signal<string | null>(null);

  // ---------- New order (phone, Telegram…) ----------

  protected readonly creating = signal(false);
  protected readonly clients = signal<Profile[]>([]);
  protected readonly services = signal<AdminServiceRow[]>([]);
  // '' = a new guest typed in below
  protected readonly clientId = signal('');

  // ---------- Lawyers, for assigning ----------

  protected readonly lawyers = signal<AdminLawyer[]>([]);
  protected readonly available = computed(() =>
    this.lawyers().filter((l) => l.status === 'approved' || l.status === 'active'),
  );

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

  protected async startOrder(): Promise<void> {
    this.error.set(null);
    try {
      const [clients, services] = await Promise.all([
        this.admin.allClients(),
        this.admin.listServices(),
      ]);
      this.clients.set(
        clients
          .filter((c) => c.Status === 'active' && c.Email)
          .sort((a, b) => (a.DisplayName || a.Email).localeCompare(b.DisplayName || b.Email)),
      );
      this.services.set(services.filter((s) => s.Status === 'Active'));
      this.clientId.set('');
      this.creating.set(true);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async createOrder(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ??
      '';
    this.busy.set(true);
    this.error.set(null);
    try {
      const order = await this.admin.createOrder({
        ...(this.clientId()
          ? { clientId: this.clientId() }
          : {
              guest: {
                firstName: field('firstName'),
                lastName: field('lastName'),
                email: field('email'),
                phone: field('phone'),
              },
            }),
        items: [{ slug: field('service'), quantity: Number(field('quantity')) || 1 }],
        payment: field('payment') === 'paid' ? 'paid' : 'invoice',
        customerNotes: field('notes'),
      });
      this.creating.set(false);
      this.notice.set(`Order ${order.orderNumber} placed. The agreement was emailed to the client.`);
      await this.load();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(order: Order): Promise<void> {
    if (this.openId() === order.orderId) {
      this.openId.set(null);
      return;
    }

    this.openId.set(order.orderId);
    this.detail.set(null);
    this.notice.set(null);
    try {
      if (!this.lawyers().length) this.lawyers.set(await this.admin.listLawyers());
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

  // ---------- Paperwork and lawyers ----------

  protected remake(order: Order): Promise<void> {
    return this.act(
      () => this.admin.remakeAgreement(order.orderId),
      'A new agreement was made from the order as it is now.',
    );
  }

  protected resend(order: Order): Promise<void> {
    return this.act(
      () => this.admin.resendEmail(order.orderId),
      `The confirmation email went to ${order.customerEmail} again.`,
    );
  }

  protected assign(order: Order, lawyerId: string, role: string): Promise<void> {
    if (!lawyerId) return Promise.resolve();
    return this.act(async () => {
      await this.admin.assignLawyer(order.orderNumber, lawyerId, role === 'reviewer' ? 'reviewer' : 'lead');
      return this.orders.adminGet(order.orderId);
    }, 'Lawyer assigned and emailed.');
  }

  // Runs one change, shows the order as it is after it
  private async act(change: () => Promise<Order>, done: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const updated = await change();
      this.detail.set(await this.orders.adminGet(updated.orderId));
      this.notice.set(done);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
