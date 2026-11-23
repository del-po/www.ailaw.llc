import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { LegalService, ServiceCategory } from '../models/legal-service';

// Google Apps Script web app reading the Products and Categories sheets
const SERVICES_API =
  'https://script.google.com/macros/s/AKfycbyNs3jIEwcxkMs6B5311wqt3gkbDseNf2zOQgpKu0vmskRE9mLTK0jqvDq8wPBl4XyS/exec';

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
}

interface ApiCategory {
  ID: number;
  Name: string;
}

type ApiResult<T> = T | { error: string };

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
    return this.http.get<ApiResult<T>>(SERVICES_API, { params }).pipe(map(unwrap));
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
  };
}

// The API reports problems as { error } with a 200 status, so turn those into real errors
function unwrap<T>(result: ApiResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error);
  }
  return result as T;
}
