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
}

export interface ServiceCategory {
  id: number;
  name: string;
}
