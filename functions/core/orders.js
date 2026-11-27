// ==========================================================
// Core: order records
//   createOrder   prices from the Services records only (never from the
//                 browser), the client's level checked against the
//                 service's "requires", the order + its Items written at once
//   toOrder       the shape the website shows
//   orderCard     the card the chat shows
// What happens after (folder, agreement, email, steps) is the ordering
// plugin's job; the payment is the on-paid job's.
// ==========================================================

import { ApiError, cleanText, db, formatDate, iso, now, uuid } from './app.js';
import {
  LEVELS,
  chatSettings,
  clientByUid,
  clientLevel,
  orderByNumber,
  orderSteps,
  priceOf,
  serviceBySlug,
} from './records.js';

const toCents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

// items: [{ slug, quantity }]; extra: { source, conversationId, details, customerNotes, … }
export async function createOrder(caller, items, extra = {}) {
  if (!caller.signedIn) throw new ApiError('AUTH_REQUIRED');
  if (!caller.emailVerified) throw new ApiError('EMAIL_NOT_VERIFIED');
  if (!Array.isArray(items) || !items.length) throw new ApiError('CART_EMPTY');
  if (items.length > 50) throw new ApiError('CART_LIMIT');

  const client = caller.client || (await clientByUid(caller.uid));
  if (!client) throw new ApiError('PROFILE_REQUIRED');
  if (client.status && client.status !== 'active') throw new ApiError('ACCOUNT_INACTIVE');
  const level = clientLevel(client);

  const seen = new Set();
  let currency = null;
  let subtotal = 0;
  let discounts = 0;
  const lines = [];
  for (const item of items) {
    const service = await serviceBySlug(String(item?.slug || ''));
    if (!service || service.status !== 'active') throw new ApiError('PRODUCT_UNAVAILABLE');
    if (seen.has(service.serviceId)) throw new ApiError('DUPLICATE_ITEM');
    seen.add(service.serviceId);
    if (level < (LEVELS[service.requires || 'user'] ?? 1)) throw new ApiError('VERIFICATION_REQUIRED');
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new ApiError('INVALID_QUANTITY');

    currency ||= service.currency || 'GEL';
    if ((service.currency || 'GEL') !== currency) throw new ApiError('MIXED_CURRENCIES');
    const { price, finalPrice } = priceOf(service);
    const list = toCents(price);
    const unit = toCents(finalPrice);
    subtotal += list * quantity;
    discounts += (list - unit) * quantity;
    lines.push({
      serviceId: service.serviceId,
      name: service.name,
      plugin: service.plugin || '',
      quantity,
      unitPrice: list / 100,
      discountAmount: ((list - unit) * quantity) / 100,
      taxAmount: 0,
      lineTotal: (unit * quantity) / 100,
    });
  }

  const orderId = uuid();
  const orderNumber = 'AIL-' + formatDate(new Date(), 'yyyyMMdd') + '-' + orderId.slice(0, 8).toUpperCase();
  const total = (subtotal - discounts) / 100;
  const order = {
    orderId,
    orderNumber,
    serviceId: lines.length === 1 ? lines[0].serviceId : '',
    serviceName: lines.length === 1 ? lines[0].name : lines.length + ' services',
    clientId: client.id,
    userId: caller.uid,
    customerName: cleanText(extra.customerName || client.displayName || caller.name || '', 120),
    customerEmail: String(caller.email || '').toLowerCase(),
    customerPhone: cleanText(extra.customerPhone || client.phone || '', 40),
    passport: client.passport || '',
    idNumber: client.idNumber || '',
    address: client.address || '',
    billingAddress: cleanText(extra.billingAddress || '', 500),
    currency,
    subtotal: subtotal / 100,
    discountTotal: discounts / 100,
    taxTotal: 0,
    total,
    orderStatus: 'placed',
    paymentStatus: 'unpaid',
    paymentMethod: 'invoice',
    paymentProvider: 'bank-transfer',
    paymentReference: orderNumber,
    customerNotes: cleanText(extra.customerNotes || '', 1000),
    source: extra.source || 'website',
    conversationId: extra.conversationId || '',
    details: extra.details || {},
    folder: '',
    internalFolder: '',
    agreement: '',
    emailedAt: null,
    createdAt: now(),
    updatedAt: now(),
    paidAt: null,
    completedAt: null,
  };

  const batch = db.batch();
  const ref = db.doc('Orders/' + orderNumber);
  batch.set(ref, order);
  lines.forEach((line, i) => batch.set(ref.collection('Items').doc(String(i + 1)), line));
  await batch.commit();
  return { order, lines };
}

// What the client sees after ordering: how to pay
export async function paymentInfo(order) {
  const bank = await chatSettings();
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    total: order.total,
    currency: order.currency,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    payment: {
      method: 'bank-transfer',
      recipient: bank.BankRecipient || 'AI Law LLC',
      iban: bank.BankIban || '',
      reference: order.orderNumber,
    },
  };
}

// The order card the chat shows: labels and statuses, never who does a step
export async function orderCard(orderNumber) {
  const order = await orderByNumber(orderNumber);
  const steps = await orderSteps(orderNumber);
  const done = order.orderStatus === 'completed';
  return {
    type: 'order',
    orderId: order.orderNumber,
    title: order.serviceName,
    status: done || order.orderStatus === 'cancelled' ? order.orderStatus : 'in_progress',
    steps: steps.map((s) => ({ label: s.clientLabel, status: s.status === 'active' ? 'in_progress' : s.status })),
  };
}

// The website's Order shape
export function toOrder(o, items) {
  const order = {
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    service: o.serviceName,
    currency: o.currency,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    customerPhone: o.customerPhone || '',
    subtotal: Number(o.subtotal),
    discountTotal: Number(o.discountTotal),
    taxTotal: Number(o.taxTotal),
    total: Number(o.total),
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    paymentProvider: o.paymentProvider || '',
    paymentReference: o.paymentReference || '',
    billingAddress: o.billingAddress || '',
    customerNotes: o.customerNotes || '',
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    paidAt: iso(o.paidAt),
    completedAt: iso(o.completedAt),
    source: o.source || '',
    conversationId: o.conversationId || '',
    details: o.details || {},
  };
  if (items) {
    order.items = items.map((i) => ({
      orderItemId: i.id,
      productId: i.serviceId,
      name: i.name,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      discountAmount: Number(i.discountAmount),
      taxAmount: Number(i.taxAmount),
      lineTotal: Number(i.lineTotal),
    }));
  }
  return order;
}
