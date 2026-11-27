// ==========================================================
// Core: order records
//   createOrder   prices from the Services records only (never from the
//                 browser), the client's level checked against the
//                 service's "requires", the order + its Items written at once
//   CHECKOUT_FIELDS  the client details a service can ask for at checkout;
//                 each service marks each one required, optional or not asked
//                 (Services/{slug}.checkoutFields), and the checkout asks for
//                 what the services in the cart ask for
//   Ongoing services (Services/{slug}.billing = "ongoing", e.g. 1% declarations):
//                 nothing is due when ordering; the agreement runs until the
//                 client cancels and states the fee per unit (unitLabel)
//   onOrderPlaced a service's plugin hears about each new order of it (e.g.
//                 1% declarations puts the client on its list)
//   toOrder       the shape the website shows
//   orderCard     the card the chat shows
// What happens after (folder, agreement, email, steps) is the ordering
// plugin's job; the payment is the on-paid job's.
// ==========================================================

import { ApiError, cleanText, db, formatDate, iso, log, now, uuid } from './app.js';
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

// ---------- Checkout fields ----------

// key: where the value goes on the order ("details." = inside order.details)
export const CHECKOUT_FIELDS = Object.freeze({
  phone: { label: 'Phone', max: 30, key: 'customerPhone' },
  address: { label: 'Address', max: 300, key: 'address' },
  idNumber: { label: 'Personal ID number', max: 20, key: 'idNumber' },
  passport: { label: 'Passport number', max: 40, key: 'passport' },
  companyName: { label: 'Company name', max: 200, key: 'details.companyName' },
  companyId: { label: 'Company ID', max: 20, key: 'details.companyId' },
  registrationId: { label: 'Registration ID (rs.ge tax ID)', max: 20, key: 'details.registrationId' },
});
export const FIELD_RULES = ['required', 'optional'];

// The services' rules together: a field required by any service is required
export function checkoutRules(serviceList) {
  const rules = {};
  for (const s of serviceList) {
    for (const [field, rule] of Object.entries(s.checkoutFields || {})) {
      if (!CHECKOUT_FIELDS[field] || !FIELD_RULES.includes(rule)) continue;
      if (rule === 'required' || !rules[field]) rules[field] = rule;
    }
  }
  return rules;
}

// ---------- Plugins that follow their service's orders ----------

const hooks = {};
export function onOrderPlaced(pluginId, run) {
  hooks[pluginId] = run;
}

// items: [{ slug, quantity }]; extra: { source, conversationId, details, customerNotes, … }
// An admin ordering for someone passes extra.client (the client record):
// then the caller's own login, email check and verification level don't apply
export async function createOrder(caller, items, extra = {}) {
  const byAdmin = !!extra.client;
  if (!byAdmin && !caller.signedIn) throw new ApiError('AUTH_REQUIRED');
  if (!byAdmin && !caller.emailVerified) throw new ApiError('EMAIL_NOT_VERIFIED');
  if (!Array.isArray(items) || !items.length) throw new ApiError('CART_EMPTY');
  if (items.length > 50) throw new ApiError('CART_LIMIT');

  const client = extra.client || caller.client || (await clientByUid(caller.uid));
  if (!client) throw new ApiError('PROFILE_REQUIRED');
  if (client.status && client.status !== 'active') throw new ApiError('ACCOUNT_INACTIVE');
  const level = byAdmin ? LEVELS.verified : clientLevel(client);

  const seen = new Set();
  const serviceList = [];
  let rate = null;
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
    const ongoing = service.billing === 'ongoing';
    // An ongoing service is its own agreement: ordered alone, once
    if (ongoing && (items.length > 1 || quantity !== 1)) throw new ApiError('ONGOING_ALONE');
    serviceList.push(service);

    currency ||= service.currency || 'GEL';
    if ((service.currency || 'GEL') !== currency) throw new ApiError('MIXED_CURRENCIES');
    const { price, finalPrice } = priceOf(service);
    if (ongoing) {
      // Nothing is due now: the fee per unit goes on the agreement
      rate = { amount: finalPrice, unitLabel: service.unitLabel || 'per service' };
      lines.push({
        serviceId: service.serviceId,
        name: service.name,
        plugin: service.plugin || '',
        quantity: 1,
        unitPrice: 0,
        discountAmount: 0,
        taxAmount: 0,
        lineTotal: 0,
        rate: finalPrice,
        unitLabel: rate.unitLabel,
      });
      continue;
    }
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

  // The client details the services ask for (only from the website's
  // checkout: extra.fields; admin and chat orders bring their own)
  const asked = {};
  if (extra.fields) {
    const rules = checkoutRules(serviceList);
    for (const [field, rule] of Object.entries(rules)) {
      const spec = CHECKOUT_FIELDS[field];
      const value = cleanText(extra.fields[field] ?? '', spec.max, 'INVALID_' + field.toUpperCase());
      if (!value && rule === 'required') throw new ApiError('MISSING_' + field.toUpperCase());
      if (value) asked[spec.key] = value;
    }
  }
  const details = { ...(extra.details || {}) };
  for (const [key, value] of Object.entries(asked)) if (key.startsWith('details.')) details[key.slice(8)] = value;

  const orderId = uuid();
  const orderNumber = 'AIL-' + formatDate(new Date(), 'yyyyMMdd') + '-' + orderId.slice(0, 8).toUpperCase();
  const total = (subtotal - discounts) / 100;
  const order = {
    orderId,
    orderNumber,
    serviceId: lines.length === 1 ? lines[0].serviceId : '',
    serviceName: lines.length === 1 ? lines[0].name : lines.length + ' services',
    clientId: client.id,
    userId: byAdmin ? client.userId || '' : caller.uid,
    customerName: cleanText(extra.customerName || client.displayName || caller.name || '', 120),
    customerEmail: String((byAdmin ? client.email : caller.email) || '').toLowerCase(),
    customerPhone: asked.customerPhone || cleanText(extra.customerPhone || client.phone || '', 40),
    passport: asked.passport || client.passport || '',
    idNumber: asked.idNumber || client.idNumber || '',
    address: asked.address || client.address || '',
    billingAddress: cleanText(extra.billingAddress || '', 500),
    currency,
    subtotal: subtotal / 100,
    discountTotal: discounts / 100,
    taxTotal: 0,
    total,
    // Ongoing: running from the start, billed per unit; nothing due now
    billing: rate ? 'ongoing' : 'once',
    rate: rate ? rate.amount : null,
    unitLabel: rate ? rate.unitLabel : '',
    orderStatus: rate ? 'in_progress' : 'placed',
    paymentStatus: 'unpaid',
    paymentMethod: extra.paymentMethod || 'invoice',
    paymentProvider: 'bank-transfer',
    paymentReference: orderNumber,
    customerNotes: cleanText(extra.customerNotes || '', 1000),
    source: extra.source || 'website',
    conversationId: extra.conversationId || '',
    details,
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

  // Plugins that follow their service's orders; a failure there is logged,
  // never a reason to lose the order
  for (const line of lines) {
    if (!hooks[line.plugin]) continue;
    try {
      await hooks[line.plugin](order, client, line);
    } catch (err) {
      await log('order hook ' + line.plugin + ' ' + orderNumber, err);
    }
  }
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
    billing: order.billing || 'once',
    rate: order.rate ?? null,
    unitLabel: order.unitLabel || '',
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
    billing: o.billing || 'once',
    rate: o.rate ?? null,
    unitLabel: o.unitLabel || '',
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
