import { Service, afterNextRender, computed, effect, signal } from '@angular/core';

// The cart keeps only slugs and quantities. Names and prices are always read
// fresh from the Services API, so the cart never shows (or charges) an old price.
export interface CartItem {
  slug: string;
  quantity: number;
}

const STORAGE_KEY = 'cart';
export const MAX_QUANTITY = 20;

@Service()
export class CartService {
  readonly items = signal<CartItem[]>([]);

  // Number shown on the cart badge
  readonly count = computed(() => this.items().reduce((sum, item) => sum + item.quantity, 0));

  // True once the saved cart has been read, so pages don't flash "empty" first
  readonly loaded = signal(false);

  constructor() {
    // Read the saved cart only after the first render, so the server page and
    // the browser page start out identical (no hydration mismatch on the badge)
    afterNextRender(() => {
      this.items.set(load());
      this.loaded.set(true);
    });

    effect(() => {
      const items = this.items();
      if (this.loaded()) save(items);
    });
  }

  add(slug: string, quantity = 1): void {
    this.items.update((items) => {
      const existing = items.find((item) => item.slug === slug);
      if (!existing) return [...items, { slug, quantity: clamp(quantity) }];

      return items.map((item) =>
        item.slug === slug ? { ...item, quantity: clamp(item.quantity + quantity) } : item,
      );
    });
  }

  setQuantity(slug: string, quantity: number): void {
    this.items.update((items) =>
      items.map((item) => (item.slug === slug ? { ...item, quantity: clamp(quantity) } : item)),
    );
  }

  remove(slug: string): void {
    this.items.update((items) => items.filter((item) => item.slug !== slug));
  }

  clear(): void {
    this.items.set([]);
  }
}

function clamp(quantity: number): number {
  return Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity) || 1));
}

function load(): CartItem[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved)
      ? saved
          .filter((item) => typeof item?.slug === 'string')
          .map((item) => ({
            slug: item.slug,
            quantity: clamp(item.quantity),
          }))
      : [];
  } catch {
    return [];
  }
}

function save(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked (private mode, full quota): the cart just isn't remembered
  }
}
