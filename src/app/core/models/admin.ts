// Rows as the admin sees them: every status, raw prices and discount dates

export type ServiceStatus = 'Active' | 'Draft' | 'Inactive';

export interface AdminServiceRow {
  ID: number;
  Slug: string;
  Name: string;
  ShortDescription: string;
  Description: string;
  Category: string;
  Image: string; // as typed in the sheet (Drive link, file ID or URL)
  Status: ServiceStatus;
  Currency: string;
  Price: number;
  DiscountedPrice: number | '';
  DiscountStart: string; // yyyy-mm-dd or ''
  DiscountEnd: string;
}

// What the editor sends; the script fills in the ID and checks everything
export type AdminServiceInput = Omit<AdminServiceRow, 'ID'>;

export interface AdminCategory {
  ID: number;
  Name: string;
  Status: 'Active' | 'Inactive';
}
