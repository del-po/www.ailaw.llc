import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { CartService, MAX_QUANTITY } from '../../../core/services/cart.service';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { Icon } from '../../../shared/kit/icon/icon';
import { CartLine, cartTotals, joinLines } from '../cart-lines';

@Component({
  selector: 'app-cart-items-page',
  imports: [RouterLink, DecimalPipe, Header, Footer, Shape, Icon],
  templateUrl: './cart-items-page.html',
  styleUrl: './cart-items-page.scss',
})
export class CartItemsPage {
  protected readonly cart = inject(CartService);
  private readonly catalogue = inject(CatalogueService);

  protected readonly maxQuantity = MAX_QUANTITY;

  // Names and prices always come fresh from the sheet, never from the saved cart
  protected readonly services = rxResource({ stream: () => this.catalogue.getServices() });

  protected readonly loading = computed(() => !this.cart.loaded() || this.services.isLoading());

  protected readonly lines = computed(() =>
    joinLines(this.cart.items(), this.services.value() ?? []),
  );

  protected readonly available = computed(() => this.lines().filter((line) => line.service));
  protected readonly unavailable = computed(() => this.lines().filter((line) => !line.service));
  protected readonly totals = computed(() => cartTotals(this.lines()));

  protected changeQuantity(line: CartLine, step: number): void {
    this.cart.setQuantity(line.slug, line.quantity + step);
  }

  protected remove(line: CartLine): void {
    this.cart.remove(line.slug);
  }

  protected removeUnavailable(): void {
    this.unavailable().forEach((line) => this.cart.remove(line.slug));
  }
}
