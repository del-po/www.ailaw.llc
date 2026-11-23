import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { CartService, MAX_QUANTITY } from '../../../core/services/cart.service';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { Icon } from '../../../shared/kit/icon/icon';

@Component({
  selector: 'app-service-details-page',
  imports: [RouterLink, DatePipe, DecimalPipe, Header, Footer, Shape, Icon],
  templateUrl: './service-details-page.html',
  styleUrl: './service-details-page.scss',
})
export class ServiceDetailsPage {
  private readonly catalogue = inject(CatalogueService);
  private readonly cart = inject(CartService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('slug') ?? '',
  });

  protected readonly service = rxResource({
    params: () => this.slug(),
    stream: ({ params }) => this.catalogue.getService(params),
  });

  constructor() {
    // Tab title and search snippet follow the service
    effect(() => {
      const service = this.service.value();
      if (!service) return;

      this.title.setTitle(`${service.name} | AI Law`);
      this.meta.updateTag({ name: 'description', content: service.shortDescription });
    });

    // A different service starts again at quantity 1
    effect(() => {
      this.slug();
      this.quantity.set(1);
      this.added.set(false);
    });
  }

  // ---------- Quantity ----------

  protected readonly maxQuantity = MAX_QUANTITY;
  protected readonly quantity = signal(1);

  protected changeQuantity(step: number): void {
    this.quantity.update((q) => Math.min(MAX_QUANTITY, Math.max(1, q + step)));
  }

  // ---------- Cart ----------

  protected readonly added = signal(false);

  protected addToCart(): void {
    this.cart.add(this.slug(), this.quantity());
    this.added.set(true);
  }

  protected buyNow(): void {
    this.cart.add(this.slug(), this.quantity());
    this.router.navigate(['/cart']);
  }
}
