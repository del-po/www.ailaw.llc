// Orders, as the Orders API (Google Apps Script) stores and returns them

export type OrderStatus = 'placed' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';

// What checkout sends. Only slugs and quantities: the Orders API looks up
// every price in the Services sheet itself.
export interface OrderRequest {
  items: { slug: string; quantity: number }[];
  customerName: string;
  // What the services in the cart ask for (phone, address, registrationId…)
  fields: Record<string, string>;
  customerNotes: string;
  paymentMethod: 'invoice';
}

export interface BankTransfer {
  method: 'bank-transfer';
  recipient: string;
  iban: string;
  reference: string; // the order number
}

// Returned right after the order is saved
export interface OrderPlaced {
  orderId: string;
  orderNumber: string;
  total: number;
  currency: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  // ongoing: nothing due now; rate per unitLabel until cancelled
  billing: 'once' | 'ongoing';
  rate: number | null;
  unitLabel: string;
  payment: BankTransfer;
}

export interface OrderItem {
  orderItemId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number; // regular price
  discountAmount: number; // for the whole line
  taxAmount: number;
  lineTotal: number;
}

export interface Order {
  orderId: string;
  orderNumber: string;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  billing?: 'once' | 'ongoing';
  rate?: number | null;
  unitLabel?: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentProvider: string;
  paymentReference: string;
  billingAddress: string;
  customerNotes: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  completedAt: string;
  items?: OrderItem[]; // only when a single order is opened
  assignments?: OrderAssignment[]; // only when the admin opens an order
}

// A lawyer working on an order
export interface OrderAssignment {
  lawyerId: string;
  lawyerName: string;
  role: 'lead' | 'reviewer';
  status: string;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'Placed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  refunded: 'Refunded',
};
