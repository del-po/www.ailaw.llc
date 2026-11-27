import { CheckoutRules } from './checkout-fields';

// A legal service as the website uses it (mapped from the Services API)

export interface LegalService {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  category: string;
  image: string;
  currency: string; // ISO code, e.g. GEL
  price: number; // regular price
  finalPrice: number; // what the customer pays today
  onSale: boolean;
  discountEnd: string; // yyyy-mm-dd, only while on sale
  // once: paid when ordered; ongoing: nothing due when ordering, then the
  // price per unit (e.g. "per declaration") until the client cancels
  billing: 'once' | 'ongoing';
  unitLabel: string;
  checkoutFields: CheckoutRules;
}

export interface ServiceCategory {
  id: number;
  name: string;
}
