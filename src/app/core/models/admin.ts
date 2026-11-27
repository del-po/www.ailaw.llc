// Rows as the admin sees them: every status, raw prices and discount dates

export type ServiceStatus = 'Active' | 'Draft' | 'Inactive';

export interface AdminServiceRow {
  ID: number;
  Slug: string;
  Name: string;
  ShortDescription: string;
  Description: string;
  Category: string;
  Image: string; // Storage path (services/…), or an image URL
  Status: ServiceStatus;
  Currency: string;
  Price: number;
  DiscountedPrice: number | '';
  DiscountStart: string; // yyyy-mm-dd or ''
  DiscountEnd: string;
}

// What the editor sends; the backend fills in the ID and checks everything
export type AdminServiceInput = Omit<AdminServiceRow, 'ID'>;

export interface AdminCategory {
  ID: number;
  Name: string;
  Status: 'Active' | 'Inactive';
}

// ---------- Orders ----------

// A picture or file sent to the backend
export interface Upload {
  name: string;
  type: string;
  data: string; // base64
}

// An order typed in by the admin (phone, Telegram…): for an existing client
// (clientId) or a new guest
export interface AdminNewOrder {
  clientId?: string;
  guest?: { firstName: string; lastName: string; email: string; phone: string };
  items: { slug: string; quantity: number }[];
  payment: 'invoice' | 'paid';
  customerNotes: string;
}

// ---------- Blog ----------

export type PostStatus = 'draft' | 'published';

export interface AdminPostRow {
  slug: string;
  title: string;
  category: string;
  featured: boolean;
  status: PostStatus;
  publishedAt: string; // ISO or ''
  updatedAt: string;
}

export interface AdminPost {
  slug: string;
  title: string;
  deck: string;
  body: string; // Markdown
  author: string;
  category: string;
  tags: string; // comma-separated
  featured: boolean;
  status: PostStatus;
  cover: string; // picture link or ''
  publishedAt: string;
  updatedAt: string;
}
