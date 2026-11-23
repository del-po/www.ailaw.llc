import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { CatalogueService } from '../../../core/services/catalogue.service';
import { CartService } from '../../../core/services/cart.service';
import { LegalService } from '../../../core/models/legal-service';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { Icon } from '../../../shared/kit/icon/icon';

const ALL = 'All';

@Component({
  selector: 'app-services-list-page',
  imports: [RouterLink, DecimalPipe, Header, Footer, Shape, Icon],
  templateUrl: './services-list-page.html',
  styleUrl: './services-list-page.scss',
})
export class ServicesListPage {
  private readonly catalogue = inject(CatalogueService);
  private readonly cart = inject(CartService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly services = rxResource({ stream: () => this.catalogue.getServices() });

  // Filters live in the address (?category=…&q=…), so every filtered view has its own link
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly category = computed(() => this.query().get('category') ?? ALL);
  protected readonly search = computed(() => this.query().get('q') ?? '');

  // Only categories that have at least one service
  protected readonly categories = computed(() => {
    const names = (this.services.value() ?? []).map((s) => s.category);
    return [ALL, ...new Set(names)];
  });

  protected readonly list = computed(() => {
    const category = this.category();
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);

    return (this.services.value() ?? []).filter((service) => {
      if (category !== ALL && service.category !== category) return false;

      const haystack = [service.name, service.shortDescription, service.category]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  });

  protected setCategory(name: string): void {
    this.updateQuery({ category: name === ALL ? null : name });
  }

  protected setSearch(value: string): void {
    this.updateQuery({ q: value.trim() || null });
  }

  private updateQuery(params: Record<string, string | null>): void {
    this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---------- Cart ----------

  // Slug of the service just added, for a short tick on its button
  protected readonly justAdded = signal<string | null>(null);
  private addedTimer?: ReturnType<typeof setTimeout>;

  protected addToCart(service: LegalService): void {
    this.cart.add(service.slug);
    this.justAdded.set(service.slug);

    clearTimeout(this.addedTimer);
    this.addedTimer = setTimeout(() => this.justAdded.set(null), 1400);
  }
}
