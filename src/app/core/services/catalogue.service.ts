import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { CheckoutRules } from '../models/checkout-fields';
import { LegalService, ServiceCategory } from '../models/legal-service';
import { DOORS, DoorResult } from './doors';

// Field names as the API sends them
interface ApiService {
  ID: number;
  Slug: string;
  Name: string;
  ShortDescription: string;
  Description: string;
  Category: string;
  Image: string;
  Currency: string;
  Price: number;
  FinalPrice: number;
  OnSale: boolean;
  DiscountEnd: string;
  Billing?: 'once' | 'ongoing';
  UnitLabel?: string;
  CheckoutFields?: CheckoutRules;
}

interface ApiCategory {
  ID: number;
  Name: string;
}

@Service()
export class CatalogueService {
  private readonly http = inject(HttpClient);

  getServices(): Observable<LegalService[]> {
    return this.get<ApiService[]>({ action: 'services' }).pipe(
      map((list) => list.map(toLegalService)),
    );
  }

  // null when no Active service has this slug
  getService(slug: string): Observable<LegalService | null> {
    return this.get<ApiService | null>({ action: 'service', slug }).pipe(
      map((item) => (item ? toLegalService(item) : null)),
    );
  }

  getCategories(): Observable<ServiceCategory[]> {
    return this.get<ApiCategory[]>({ action: 'categories' }).pipe(
      map((list) => list.map((c) => ({ id: c.ID, name: c.Name }))),
    );
  }

  private get<T>(params: Record<string, string>): Observable<T> {
    return this.http.get<DoorResult<T>>(DOORS.client, { params }).pipe(map(unwrap));
  }
}

function toLegalService(s: ApiService): LegalService {
  return {
    id: s.ID,
    slug: s.Slug,
    name: s.Name,
    shortDescription: s.ShortDescription,
    description: s.Description,
    category: s.Category,
    image: s.Image,
    currency: s.Currency,
    price: s.Price,
    finalPrice: s.FinalPrice,
    onSale: s.OnSale,
    discountEnd: s.DiscountEnd,
    billing: s.Billing === 'ongoing' ? 'ongoing' : 'once',
    unitLabel: s.UnitLabel ?? '',
    checkoutFields: s.CheckoutFields ?? {},
  };
}

// Problems come back as { ok: false, error } with a 200 status: turn them into real errors
function unwrap<T>(result: DoorResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
