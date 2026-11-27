import { CartItem } from '../../core/services/cart.service';
import { LegalService } from '../../core/models/legal-service';

// A cart item joined with the service's current details. `service` is null
// when the service was removed or deactivated after it was added.
export interface CartLine {
  slug: string;
  quantity: number;
  service: LegalService | null;
}

export interface CartTotals {
  count: number; // services that can be bought, quantities included
  subtotal: number; // at regular prices
  total: number; // what will be paid
  savings: number;
  currency: string;
}

export function joinLines(items: CartItem[], services: LegalService[]): CartLine[] {
  return items.map((item) => ({
    ...item,
    service: services.find((s) => s.slug === item.slug) ?? null,
  }));
}

// "50 GEL" or, for an ongoing service, "50 GEL per declaration"
export function priceLabel(service: LegalService, amount = service.finalPrice): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return (
    `${value} ${service.currency}` + (service.billing === 'ongoing' ? ' ' + service.unitLabel : '')
  );
}

// Unavailable lines are left out; ongoing services cost nothing now. All
// services share one currency today, so the first line's is used.
export function cartTotals(lines: CartLine[]): CartTotals {
  const available = lines.filter((line) => line.service && line.service.billing !== 'ongoing');
  const sum = (price: (s: LegalService) => number) =>
    available.reduce((total, line) => total + price(line.service!) * line.quantity, 0);

  const subtotal = sum((s) => s.price);
  const total = sum((s) => s.finalPrice);

  return {
    count: lines.filter((line) => line.service).reduce((n, line) => n + line.quantity, 0),
    subtotal,
    total,
    savings: subtotal - total,
    currency: lines.find((line) => line.service)?.service?.currency ?? 'GEL',
  };
}
