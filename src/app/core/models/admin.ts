import { CheckoutRules } from './checkout-fields';

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
  // once: paid when ordered; ongoing: fee per UnitLabel until cancelled
  Billing: 'once' | 'ongoing';
  UnitLabel: string;
  // What checkout asks for when this service is in the cart
  CheckoutFields: CheckoutRules;
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

// ---------- Dashboard (admin:dashboard) ----------

// Amounts per currency, e.g. { GEL: 120 }
export type Amounts = Record<string, number>;

export interface AuditChange {
  from: unknown;
  to: unknown;
}

// One line of the audit log: an admin change, from the panel or the chat
export interface AuditEntry {
  id: string;
  time: string;
  who: string;
  email: string;
  via: 'panel' | 'chat';
  action: string;
  target: { kind: string; id: string } | null;
  changes: Record<string, AuditChange> | null;
  data: Record<string, unknown> | null;
  ok: boolean;
  error: string;
}

export interface ErrorEntry {
  id: string;
  time: string;
  action: string;
  error: string;
  details: string;
}

export interface StuckStep {
  orderNumber: string;
  service: string;
  step: string;
  owner: 'chat' | 'lawyer';
  since: string;
}

export interface SeriesPoint {
  key: string;
  orders: number;
  revenue: number;
}

export interface Dashboard {
  period: { from: string; to: string };
  clients: {
    total: number;
    user: number;
    verified: number;
    guest: number;
    suspended: number;
    new: number;
  };
  orders: {
    total: number;
    new: number;
    byStatus: Record<'placed' | 'in_progress' | 'completed' | 'cancelled', number>;
  };
  revenue: Amounts;
  outstanding: { count: number; amounts: Amounts };
  services: { active: number; total: number };
  lawyers: { active: number; applications: number };
  tasksWaiting: number;
  stuck: { days: number; count: number; list: StuckStep[] };
  errors: { count: number; latest: { time: string; action: string; error: string }[] };
  chat: { questions: number };
  // Not tracked yet
  aiSpending: Amounts | null;
  traffic: number | null;
  recent: AuditEntry[];
  series: { unit: 'day' | 'month'; currency: string; points: SeriesPoint[] };
}

// A period by Tbilisi days, "yyyy-MM-dd"
export interface Period {
  from: string;
  to: string;
}
