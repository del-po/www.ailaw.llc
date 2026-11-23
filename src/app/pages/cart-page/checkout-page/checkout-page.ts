import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { OrderService } from '../../../core/services/order.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { cartTotals, joinLines } from '../cart-lines';

@Component({
  selector: 'app-checkout-page',
  imports: [RouterLink, DecimalPipe, Header, Footer, Shape],
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage {
  protected readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly catalogue = inject(CatalogueService);
  private readonly orders = inject(OrderService);
  private readonly router = inject(Router);

  // Prices shown here are the sheet's current ones; the backend checks them again
  protected readonly services = rxResource({ stream: () => this.catalogue.getServices() });

  protected readonly loading = computed(() => !this.cart.loaded() || this.services.isLoading());

  protected readonly lines = computed(() =>
    joinLines(this.cart.items(), this.services.value() ?? []).filter((line) => line.service),
  );

  protected readonly totals = computed(() => cartTotals(this.lines()));

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Name and phone are filled in from the profile
    afterNextRender(() => this.auth.loadProfile().catch(() => undefined));
  }

  protected async placeOrder(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();

    const name = field('name');
    const phone = field('phone');

    this.busy.set(true);
    this.error.set(null);

    try {
      // A phone given here is kept in the profile for next time
      if (!this.auth.profile()?.Phone) {
        await this.auth.updateProfile({ phone }).catch(() => undefined);
      }

      const placed = await this.orders.place({
        items: this.lines().map(({ slug, quantity }) => ({ slug, quantity })),
        customerName: name,
        customerPhone: phone,
        customerNotes: field('note'),
      });

      // The confirmation page shows the transfer details and empties the cart
      await this.router.navigate(['/payment/success'], {
        queryParams: { order: placed.orderId },
        state: { placed },
      });
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.busy.set(false);
    }
  }
}
