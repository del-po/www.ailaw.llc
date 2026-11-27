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
import { cartTotals, joinLines, priceLabel } from '../cart-lines';
import {
  CHECKOUT_FIELDS,
  CheckoutField,
  CheckoutRules,
} from '../../../core/models/checkout-fields';

// Ways to pay: only invoice works today; the rest are shown as coming
const PAYMENT_METHODS = [
  { value: 'invoice', label: 'Invoice · bank transfer', ready: true },
  { value: 'card', label: 'Card', ready: false },
  { value: 'paypal', label: 'PayPal', ready: false },
  { value: 'apple-pay', label: 'Apple Pay', ready: false },
  { value: 'google-pay', label: 'Google Pay', ready: false },
];

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
  protected readonly priceLabel = priceLabel;
  protected readonly paymentMethods = PAYMENT_METHODS;

  // What the services in the cart ask for: a field one service requires is required
  protected readonly rules = computed(() => {
    const rules: CheckoutRules = {};
    for (const line of this.lines()) {
      for (const [key, rule] of Object.entries(line.service!.checkoutFields)) {
        const k = key as keyof CheckoutRules;
        if (rule === 'required' || !rules[k]) rules[k] = rule;
      }
    }
    return rules;
  });
  protected readonly fields = computed(() => CHECKOUT_FIELDS.filter((f) => this.rules()[f.key]));
  protected readonly ongoing = computed(() =>
    this.lines().some((l) => l.service!.billing === 'ongoing'),
  );

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Name and details are filled in from the profile
    afterNextRender(() => this.auth.loadProfile().catch(() => undefined));
  }

  // What the profile already knows for a field
  protected known(field: CheckoutField): string {
    const p = this.auth.profile();
    const known: Partial<Record<string, string | undefined>> = {
      phone: p?.Phone,
      address: p?.Address,
      idNumber: p?.IDNumber,
      passport: p?.Passport,
    };
    return known[field.key] ?? '';
  }

  protected async placeOrder(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value.trim();

    const name = field('name');
    const fields: Record<string, string> = {};
    for (const f of this.fields()) fields[f.key] = field(f.key);

    this.busy.set(true);
    this.error.set(null);

    try {
      // A phone given here is kept in the profile for next time
      if (fields['phone'] && !this.auth.profile()?.Phone) {
        await this.auth.updateProfile({ phone: fields['phone'] }).catch(() => undefined);
      }

      const placed = await this.orders.place({
        items: this.lines().map(({ slug, quantity }) => ({ slug, quantity })),
        customerName: name,
        fields,
        customerNotes: field('note'),
        paymentMethod: 'invoice',
      });

      // The confirmation page shows the transfer details and empties the cart
      await this.router.navigate(['/payment/success'], {
        queryParams: { order: placed.orderId },
        state: { placed },
      });
    } catch (error) {
      // MISSING_PHONE and the like name the field
      const code = (error as Error)?.message ?? '';
      const missing = CHECKOUT_FIELDS.find((f) => code === 'MISSING_' + f.key.toUpperCase());
      this.error.set(missing ? `${missing.label} is required.` : authErrorMessage(error));
      this.busy.set(false);
    }
  }
}
