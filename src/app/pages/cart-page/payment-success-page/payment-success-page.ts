import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { OrderService } from '../../../core/services/order.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { OrderPlaced } from '../../../core/models/order';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { BankTransfer } from '../../../shared/components/bank-transfer/bank-transfer';

// What the page needs to show, whether it came from checkout or from the Orders API
interface Confirmation {
  orderNumber: string;
  total: number;
  currency: string;
  paid: boolean;
  // Ongoing service: nothing to pay now, the fee per unit later
  ongoing: boolean;
  rate: number | null;
  unitLabel: string;
}

// Opened after placing an order (?order=…). Shows the order number and, while
// unpaid, the bank transfer details. Reloading the page fetches the order again.
@Component({
  selector: 'app-payment-success-page',
  imports: [RouterLink, DecimalPipe, Header, Footer, Shape, BankTransfer],
  templateUrl: './payment-success-page.html',
  styleUrl: './payment-success-page.scss',
})
export class PaymentSuccessPage {
  private readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly orders = inject(OrderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly order = signal<Confirmation | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Checkout hands the new order over directly, so no second request is needed
    const placed = this.router.getCurrentNavigation()?.extras.state?.['placed'] as
      OrderPlaced | undefined;
    if (placed) {
      this.order.set({
        orderNumber: placed.orderNumber,
        total: placed.total,
        currency: placed.currency,
        paid: placed.paymentStatus === 'paid',
        ongoing: placed.billing === 'ongoing',
        rate: placed.rate,
        unitLabel: placed.unitLabel,
      });
    }

    afterNextRender(() => {
      // The order is saved, so the cart starts empty again
      this.cart.clear();
      if (!this.order()) this.load();
    });
  }

  private async load(): Promise<void> {
    const orderId = this.route.snapshot.queryParamMap.get('order');
    if (!orderId) {
      this.error.set('ORDER_NOT_FOUND');
      return;
    }

    try {
      await this.auth.whenReady();
      const order = await this.orders.get(orderId);
      this.order.set({
        orderNumber: order.orderNumber,
        total: order.total,
        currency: order.currency,
        paid: order.paymentStatus === 'paid',
        ongoing: order.billing === 'ongoing',
        rate: order.rate ?? null,
        unitLabel: order.unitLabel ?? '',
      });
    } catch (error) {
      this.error.set(authErrorMessage(error));
    }
  }
}
